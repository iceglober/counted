// Package counted provides privacy-first event tracking.
// No cookies, no fingerprinting, no PII. Zero dependencies.
package counted

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"
)

const (
	defaultHost          = "https://app.counted.dev"
	defaultFlushInterval = 30 * time.Second
	defaultMaxBatchSize  = 50
	defaultSessionTimeout = 30 * time.Minute
	sdkVersion           = "counted-go/0.1.0"
)

// Options configures the analytics client.
type Options struct {
	ProjectKey     string
	Host           string
	FlushInterval  time.Duration
	MaxBatchSize   int
	SessionID      string
	SessionTimeout time.Duration
}

// EventProperties holds custom event properties.
type EventProperties map[string]interface{}

type systemProps struct {
	OSName     *string `json:"osName"`
	OSVersion  *string `json:"osVersion"`
	Locale     *string `json:"locale"`
	AppVersion *string `json:"appVersion"`
	DeviceModel *string `json:"deviceModel"`
	SDKVersion string  `json:"sdkVersion"`
	IsDebug    bool    `json:"isDebug"`
}

type rawEvent struct {
	Timestamp   string          `json:"timestamp"`
	SessionID   string          `json:"sessionId"`
	EventName   string          `json:"eventName"`
	SystemProps systemProps     `json:"systemProps"`
	Props       EventProperties `json:"props"`
}

// Analytics is the event tracking client.
type Analytics struct {
	projectKey     string
	host           string
	flushInterval  time.Duration
	maxBatchSize   int
	sessionTimeout time.Duration

	mu            sync.Mutex
	buffer        []rawEvent
	sessionID     string
	lastActivity  time.Time
	enabled       bool
	ticker        *time.Ticker
	done          chan struct{}
	client        *http.Client
}

// New creates a new analytics client.
func New(opts Options) *Analytics {
	host := opts.Host
	if host == "" {
		host = defaultHost
	}
	flushInterval := opts.FlushInterval
	if flushInterval == 0 {
		flushInterval = defaultFlushInterval
	}
	maxBatchSize := opts.MaxBatchSize
	if maxBatchSize == 0 {
		maxBatchSize = defaultMaxBatchSize
	}
	sessionTimeout := opts.SessionTimeout
	if sessionTimeout == 0 && opts.SessionID == "" {
		sessionTimeout = defaultSessionTimeout
	}
	sessionID := opts.SessionID
	if sessionID == "" {
		sessionID = generateSessionID()
	}

	a := &Analytics{
		projectKey:     opts.ProjectKey,
		host:           host,
		flushInterval:  flushInterval,
		maxBatchSize:   maxBatchSize,
		sessionTimeout: sessionTimeout,
		sessionID:      sessionID,
		lastActivity:   time.Now(),
		enabled:        true,
		done:           make(chan struct{}),
		client:         &http.Client{Timeout: 10 * time.Second},
	}

	a.ticker = time.NewTicker(flushInterval)
	go a.flushLoop()

	return a
}

// Track records an event with optional properties.
func (a *Analytics) Track(eventName string, props EventProperties) {
	if !a.enabled {
		return
	}

	if props == nil {
		props = EventProperties{}
	}

	event := rawEvent{
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		SessionID:   a.getSessionID(),
		EventName:   eventName,
		SystemProps: detectSystemProps(),
		Props:       props,
	}

	a.mu.Lock()
	a.buffer = append(a.buffer, event)
	shouldFlush := len(a.buffer) >= a.maxBatchSize
	a.mu.Unlock()

	if shouldFlush {
		a.Flush()
	}
}

// Flush sends all buffered events to the server.
func (a *Analytics) Flush() {
	a.mu.Lock()
	if len(a.buffer) == 0 {
		a.mu.Unlock()
		return
	}
	batch := a.buffer
	a.buffer = nil
	a.mu.Unlock()

	a.send(batch)
}

// Destroy flushes remaining events and stops the background timer.
func (a *Analytics) Destroy() {
	a.ticker.Stop()
	close(a.done)
	a.Flush()
}

// Disable stops tracking.
func (a *Analytics) Disable() {
	a.mu.Lock()
	a.enabled = false
	a.buffer = nil
	a.mu.Unlock()
}

// Enable resumes tracking.
func (a *Analytics) Enable() {
	a.mu.Lock()
	a.enabled = true
	a.mu.Unlock()
}

func (a *Analytics) flushLoop() {
	for {
		select {
		case <-a.ticker.C:
			a.Flush()
		case <-a.done:
			return
		}
	}
}

func (a *Analytics) send(events []rawEvent) {
	url := a.host + "/api/v0/event"
	data, err := json.Marshal(events)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Project-Key", a.projectKey)

	resp, err := a.client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func (a *Analytics) getSessionID() string {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now()
	if a.sessionTimeout > 0 && now.Sub(a.lastActivity) > a.sessionTimeout {
		a.sessionID = generateSessionID()
	}
	a.lastActivity = now
	return a.sessionID
}

func generateSessionID() string {
	return fmt.Sprintf("%d.%08x", time.Now().Unix(), rand.Uint32())
}

func detectSystemProps() systemProps {
	osName := runtime.GOOS
	osVersion := ""
	return systemProps{
		OSName:     &osName,
		OSVersion:  strPtr(osVersion),
		Locale:     strPtr(os.Getenv("LANG")),
		SDKVersion: sdkVersion,
	}
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ─── Module-level convenience API ──────────────────────────────────────────────

var globalClient *Analytics

// Init creates the global analytics client.
func Init(opts Options) {
	globalClient = New(opts)
}

// TrackEvent tracks an event on the global client.
func TrackEvent(eventName string, props EventProperties) {
	if globalClient != nil {
		globalClient.Track(eventName, props)
	}
}

// FlushGlobal flushes the global client.
func FlushGlobal() {
	if globalClient != nil {
		globalClient.Flush()
	}
}

// DestroyGlobal destroys the global client.
func DestroyGlobal() {
	if globalClient != nil {
		globalClient.Destroy()
		globalClient = nil
	}
}
