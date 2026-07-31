// The Go conformance driver.
//
// Speaks the line protocol on stdin/stdout. Every assertion lives in the
// runner; this only translates commands into SDK calls and reports what its
// fake transport saw.
//
// A send parks until the runner supplies an answer, because a scenario
// declares the response after asserting the request. So the flush runs on a
// goroutine and the transport blocks on a channel the main loop feeds — which
// is also how a real SDK behaves.

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	counted "github.com/iceglober/counted/packages/go"
)

type scripted struct {
	mu       sync.Mutex
	requests []map[string]any
	answers  chan map[string]any
}

func (s *scripted) Send(url, key, body string) (counted.Reply, error) {
	var parsed map[string]any
	_ = json.Unmarshal([]byte(body), &parsed)

	s.mu.Lock()
	s.requests = append(s.requests, map[string]any{
		"url":     url,
		"headers": map[string]any{"authorization": "Bearer " + key},
		"body":    parsed,
	})
	s.mu.Unlock()

	// Parks here. The main loop keeps reading stdin, so a respond can arrive
	// and release it.
	var answer map[string]any
	select {
	case answer = <-s.answers:
	case <-time.After(2 * time.Second):
		return counted.Reply{Status: 202, Body: map[string]any{"accepted": float64(1)}}, nil
	}

	if networkError, ok := answer["networkError"].(bool); ok && networkError {
		return counted.Reply{}, errors.New("connection reset")
	}

	headers := map[string]string{}
	if raw, ok := answer["headers"].(map[string]any); ok {
		for name, value := range raw {
			headers[name] = fmt.Sprint(value)
		}
	}
	replyBody, _ := answer["body"].(map[string]any)
	status := 202
	if raw, ok := answer["status"].(float64); ok {
		status = int(raw)
	}
	return counted.Reply{Status: status, Headers: headers, Body: replyBody}, nil
}

func main() {
	transport := &scripted{answers: make(chan map[string]any, 8)}

	var clockMu sync.Mutex
	now := int64(1_773_759_600_000) // 2026-03-17T15:00:00Z

	client := counted.NewClient(
		"ck_conformance",
		"https://api.test/v1/events",
		transport,
		func() int64 { clockMu.Lock(); defer clockMu.Unlock(); return now },
		// Deterministic, so a jittered backoff is still assertable.
		func() float64 { return 0.5 },
		// The real detection, so conformance compares what ships.
		counted.DetectSystem(""),
	)

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	writer := bufio.NewWriter(os.Stdout)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			continue
		}

		reply := map[string]any{"ok": true}
		switch message["cmd"] {
		case "track":
			properties, _ := message["properties"].(map[string]any)
			client.Track(fmt.Sprint(message["name"]), properties)
		case "identify":
			client.Identify(fmt.Sprint(message["userId"]))
		case "reset":
			client.Reset()
		case "flush", "advance":
			if message["cmd"] == "advance" {
				clockMu.Lock()
				now += int64(message["ms"].(float64))
				clockMu.Unlock()
			}
			go client.Flush()
			// Let it reach the transport before the next command lands.
			time.Sleep(20 * time.Millisecond)
		case "shutdown":
			go client.Shutdown()
			time.Sleep(20 * time.Millisecond)
		case "respond":
			transport.answers <- message
			// Let the parked goroutine take it and act on it. Deliberately no
			// join: one parked on an unanswered request cannot finish.
			time.Sleep(20 * time.Millisecond)
		case "settle":
			time.Sleep(20 * time.Millisecond)
		case "drain":
			transport.mu.Lock()
			reply = map[string]any{"ok": true, "requests": transport.requests}
			transport.requests = nil
			transport.mu.Unlock()
		}

		encoded, _ := json.Marshal(reply)
		writer.Write(encoded)
		writer.WriteByte('\n')
		writer.Flush()
	}
}
