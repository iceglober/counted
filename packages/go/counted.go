// Package counted is a privacy-first analytics SDK. No cookies, no
// fingerprinting, no PII, and no dependencies outside the standard library.
//
//	c := counted.New(counted.Options{Key: "ck_live_..."})
//	defer c.Shutdown()
//
//	c.Identify("user_42")           // optional, and always your own id
//	c.Track("page_view", map[string]any{"path": "/pricing"})
//
// This file is the public API. The reliability layer it wraps — the queue,
// the retries, the backoff — is in client.go, and is driven by the
// cross-language conformance suite rather than by anything here.
//
// The split exists because those two things have different audiences.
// [NewClient] takes an injected transport, clock and source of randomness,
// which is what makes the behaviour testable but is a poor thing to ask of
// somebody who wants to count page views. [New] supplies the real ones.
package counted

import (
	"bytes"
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"
)

// DefaultEndpoint is where events go unless you say otherwise. Self-hosted
// installations point this at their own API.
const DefaultEndpoint = "https://api.counted.dev/v1/events"

// Options configures a client. Only Key is required.
type Options struct {
	// Key is a public ingest key. It ships in your binary; that is by design.
	Key string

	// Endpoint overrides DefaultEndpoint.
	Endpoint string

	// AppVersion is reported in system properties, so you can break a metric
	// down by the release it came from.
	AppVersion string

	// FlushInterval is how often queued events are sent. Zero means the
	// contract default.
	FlushInterval time.Duration

	// HTTPClient overrides the client used to send batches — for a proxy, a
	// custom timeout, or a test.
	HTTPClient *http.Client
}

// New creates a client with a real HTTP transport, the system clock, and a
// background flush.
//
// A zero Key returns a client that discards everything. That is deliberate:
// analytics missing from a build is not a reason for the build to fail, and
// the alternative is every caller writing the same nil check.
func New(options Options) *Client {
	endpoint := options.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		// A bounded timeout, because a hung analytics request must not
		// outlive the thing it was measuring.
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	interval := options.FlushInterval
	if interval <= 0 {
		interval = time.Duration(FlushIntervalMs) * time.Millisecond
	}

	c := NewClient(
		options.Key,
		endpoint,
		&httpTransport{client: httpClient},
		func() int64 { return time.Now().UnixMilli() },
		rand.Float64,
		DetectSystem(options.AppVersion),
	)

	if options.Key != "" {
		c.ticker = time.NewTicker(interval)
		c.stopped = make(chan struct{})
		go func() {
			for {
				select {
				case <-c.ticker.C:
					c.Flush()
				case <-c.stopped:
					return
				}
			}
		}()
	}
	return c
}

// httpTransport is the only place in the SDK that performs I/O.
type httpTransport struct{ client *http.Client }

func (t *httpTransport) Send(url, key, body string) (Reply, error) {
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader([]byte(body)))
	if err != nil {
		return Reply{}, err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("authorization", "Bearer "+key)

	response, err := t.client.Do(request)
	if err != nil {
		// A transport error is not an answer. The caller retries it, which is
		// why it is returned rather than turned into a status code.
		return Reply{}, err
	}
	defer response.Body.Close()

	headers := map[string]string{}
	for name := range response.Header {
		headers[strings.ToLower(name)] = response.Header.Get(name)
	}

	// Read it. The previous SDK closed the body without looking, so a 401 was
	// indistinguishable from success and the receipt — which says what was
	// accepted and what was refused — was thrown away every time.
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return Reply{Status: response.StatusCode, Headers: headers}, nil
	}

	parsed := map[string]any{}
	if len(raw) > 0 {
		// A body that is not JSON is not an error: a proxy answering on the
		// server's behalf sends HTML, and the status still means something.
		_ = json.Unmarshal(raw, &parsed)
	}
	return Reply{Status: response.StatusCode, Headers: headers, Body: parsed}, nil
}
