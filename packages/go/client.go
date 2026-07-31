// The Go SDK's reliability layer.
//
// Behaviour is specified in contract/sdk-behaviour.md and enforced by the
// cross-language conformance suite: the same scenario files drive this, the
// JavaScript reference, Python and Rust, and CI will not merge until all four
// agree.
//
// What was here before closed the response body and ignored it — so a 401 was
// indistinguishable from success, a 500 dropped its events, and nothing was
// ever retried. None of that was hard to write correctly; nobody was ever told
// it was wrong.
//
// The clock, the transport and the randomness are injectable. Not for
// elegance — it is the only way the conformance driver can control time and
// failures, and behaviour that cannot be driven cannot be verified.

package counted

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Reply is what a transport gives back. An HTTP error is an answer, not a
// failure — reading its body is how retryability is learnt.
type Reply struct {
	Status  int
	Headers map[string]string
	Body    map[string]any
}

// Transport is injectable so the conformance driver can script failures.
type Transport interface {
	Send(url, key, body string) (Reply, error)
}

type QueuedEvent struct {
	Name             string         `json:"name"`
	VisitID          string         `json:"visitId"`
	OccurredAt       string         `json:"occurredAt"`
	IdempotencyKey   string         `json:"idempotencyKey"`
	UserID           *string        `json:"userId,omitempty"`
	Properties       map[string]any `json:"properties,omitempty"`
	SystemProperties map[string]any `json:"systemProperties,omitempty"`
}

type Diagnostic struct {
	Kind      string `json:"kind"`
	Status    int    `json:"status,omitempty"`
	Events    int    `json:"events,omitempty"`
	Discarded int    `json:"discarded,omitempty"`
}

type Client struct {
	key       string
	endpoint  string
	transport Transport
	clock     func() int64
	random    func() float64
	system    map[string]any

	maxBatch  int
	maxBuffer int

	mu          sync.Mutex
	buffer      []QueuedEvent
	person      *string
	visitID     string
	visitSeen   int64
	pausedUntil int64
	attempt     int
	disabled    bool
	closed      bool
	diagnostics []Diagnostic
}

func NewClient(key, endpoint string, transport Transport, clock func() int64, random func() float64, system map[string]any) *Client {
	return &Client{
		key:       key,
		endpoint:  endpoint,
		transport: transport,
		clock:     clock,
		random:    random,
		system:    system,
		maxBatch:  MaxBatchSize,
		maxBuffer: MaxBufferEvents,
	}
}

// Track never blocks and performs no I/O. SDK-001.
func (c *Client) Track(name string, properties map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.disabled {
		return
	}

	now := c.clock()
	// SDK-010/011: minted and stamped now, reused verbatim on retry. The
	// server dedups on (key, instant), so regenerating either double-counts.
	c.buffer = append(c.buffer, QueuedEvent{
		Name:             name,
		VisitID:          c.currentVisitLocked(now),
		OccurredAt:       iso(now),
		IdempotencyKey:   fmt.Sprintf("%d-%d", now, int64(c.random()*1e12)),
		UserID:           c.person,
		Properties:       properties,
		SystemProperties: c.system,
	})
	c.trimLocked()
}

// Identify attributes subsequent events to a person. SDK-060/061: always the
// customer's own id, never derived, inferred or hashed.
func (c *Client) Identify(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	trimmed := strings.TrimSpace(userID)
	if trimmed == "" {
		c.person = nil
		return
	}
	c.person = &trimmed
}

// Reset forgets the person and starts a new visit. SDK-062.
func (c *Client) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.clock()
	c.person = nil
	c.visitID = mintVisit(now, c.random())
	c.visitSeen = now
}

func (c *Client) Flush() {
	c.mu.Lock()
	if c.disabled || c.clock() < c.pausedUntil {
		c.mu.Unlock()
		return
	}
	take := len(c.buffer)
	if take > c.maxBatch {
		take = c.maxBatch
	}
	batch := make([]QueuedEvent, take)
	copy(batch, c.buffer[:take])
	c.buffer = c.buffer[take:]
	c.mu.Unlock()

	if len(batch) == 0 {
		return
	}
	c.send(batch)
}

// Shutdown flushes what is queued, then stops. SDK-080.
func (c *Client) Shutdown() {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	c.Flush()
}

func (c *Client) TakeDiagnostics() []Diagnostic {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := c.diagnostics
	c.diagnostics = nil
	return out
}

func (c *Client) send(batch []QueuedEvent) {
	payload, _ := json.Marshal(map[string]any{"events": batch})

	reply, err := c.transport.Send(c.endpoint, c.key, string(payload))
	if err != nil {
		// Not a closed body and a shrug. Nothing was heard back, so nothing
		// is known about whether it landed: requeue and back off.
		c.requeue(batch)
		c.backoff()
		return
	}

	if reply.Status >= 200 && reply.Status < 300 {
		// SDK-040: every per-event outcome settles. Only transport failures
		// and retryable statuses come back.
		c.mu.Lock()
		c.attempt = 0
		if rejected, ok := reply.Body["rejected"].(float64); ok && rejected > 0 {
			c.diagnostics = append(c.diagnostics, Diagnostic{Kind: "rejected", Events: int(rejected)})
		}
		c.mu.Unlock()
		return
	}

	if !retryable(reply) {
		c.mu.Lock()
		if contains(FatalStatuses, reply.Status) {
			// SDK-043: a credential that is missing or revoked will not become
			// valid by being asked again.
			discarded := len(c.buffer)
			c.buffer = nil
			c.disabled = true
			c.diagnostics = append(c.diagnostics, Diagnostic{Kind: "disabled", Status: reply.Status, Discarded: discarded})
			c.mu.Unlock()
			return
		}
		c.diagnostics = append(c.diagnostics, Diagnostic{Kind: "refused", Status: reply.Status})
		c.mu.Unlock()
		return
	}

	c.requeue(batch)
	if ms, ok := retryAfterMs(reply); ok {
		// SDK-041: the server said when. Believe it.
		c.mu.Lock()
		c.pausedUntil = c.clock() + ms
		c.mu.Unlock()
		return
	}
	c.backoff()
}

// backoff is exponential, capped, with full jitter. SDK-042.
//
// Without jitter every client that failed in one outage returns in the same
// millisecond and knocks the recovering server over again.
func (c *Client) backoff() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.attempt++
	ceiling := math.Min(float64(BackoffMaxMs), float64(BackoffBaseMs)*math.Pow(float64(BackoffFactor), float64(c.attempt-1)))
	c.pausedUntil = c.clock() + int64(c.random()*ceiling)
}

// requeue returns a batch to the head, so ordering survives. SDK-021.
func (c *Client) requeue(batch []QueuedEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.buffer = append(append([]QueuedEvent{}, batch...), c.buffer...)
	c.trimLocked()
}

// trimLocked bounds the buffer on insert, dropping the oldest. SDK-020/022.
func (c *Client) trimLocked() {
	excess := len(c.buffer) - c.maxBuffer
	if excess <= 0 {
		return
	}
	c.buffer = c.buffer[excess:]
	c.diagnostics = append(c.diagnostics, Diagnostic{Kind: "dropped", Events: excess})
}

// currentVisitLocked rolls the visit over after inactivity. SDK-050. A visit
// is not an identity and nothing derives one from it.
func (c *Client) currentVisitLocked(now int64) string {
	if c.visitID == "" || (VisitTimeoutMs > 0 && now-c.visitSeen > VisitTimeoutMs) {
		c.visitID = mintVisit(now, c.random())
	}
	c.visitSeen = now
	return c.visitID
}

// retryable reads the server's own answer first; the status list is the
// fallback. SDK-044.
func retryable(reply Reply) bool {
	if flag, ok := reply.Body["retryable"].(bool); ok {
		return flag
	}
	return contains(RetryableStatuses, reply.Status)
}

func retryAfterMs(reply Reply) (int64, bool) {
	for name, value := range reply.Headers {
		if strings.EqualFold(name, "retry-after") {
			if seconds, err := strconv.ParseFloat(value, 64); err == nil {
				return int64(seconds * 1000), true
			}
		}
	}
	return 0, false
}

func contains(haystack []int, needle int) bool {
	for _, candidate := range haystack {
		if candidate == needle {
			return true
		}
	}
	return false
}

func mintVisit(now int64, random float64) string {
	return fmt.Sprintf("%d.%x", now/1000, int64(random*math.Pow(36, 8)))
}

func iso(millis int64) string {
	return time.UnixMilli(millis).UTC().Format("2006-01-02T15:04:05.000Z")
}
