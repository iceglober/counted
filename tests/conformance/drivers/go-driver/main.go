// Go SDK conformance driver. Invoked as a subprocess by the orchestrator:
//
//	COUNTED_KEY=ck_... COUNTED_HOST=http://127.0.0.1:PORT go run . <scenario>
package main

import (
	"os"

	counted "github.com/iceglober/counted/packages/go"
)

func main() {
	if len(os.Args) < 2 {
		panic("scenario arg required")
	}
	scenario := os.Args[1]
	key := os.Getenv("COUNTED_KEY")
	host := os.Getenv("COUNTED_HOST")

	switch scenario {
	case "flush":
		a := counted.New(counted.Options{ProjectKey: key, Host: host, SessionID: "conf-sess"})
		a.Track("alpha", counted.EventProperties{"n": 1})
		a.Track("beta", counted.EventProperties{"n": 2})
		a.Flush()
		a.Destroy()
	case "batch":
		a := counted.New(counted.Options{ProjectKey: key, Host: host, MaxBatchSize: 3})
		a.Track("e1", nil)
		a.Track("e2", nil)
		a.Track("e3", nil) // hits the cap -> auto flush
		a.Destroy()
	case "exit":
		a := counted.New(counted.Options{ProjectKey: key, Host: host})
		a.Track("onexit", nil)
		// Go has no automatic exit handler; Destroy() is its documented
		// shutdown flush, and send is synchronous so the event is delivered.
		a.Destroy()
	default:
		panic("unknown scenario: " + scenario)
	}
}
