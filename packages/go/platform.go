// Canonical platform detection.
//
// SDK-070/071. The value sent is the closed enum the server stores — "macos",
// not "darwin". One macOS machine used to report four different values
// depending on which SDK was running: "macOS" from JavaScript, "darwin" from
// Go, "Mac OS X" from a user-agent, "macos" from Rust. All four landed in the
// same column, so every breakdown by operating system showed macOS four times
// with the traffic split between them.
//
// The alias table is generated from contract/gen/contract.json, so the four
// languages cannot disagree about the mapping — and the conformance suite
// asserts they agree about the *result*, on the same machine, which is the
// test whose absence let this happen.

package counted

import (
	"os"
	"runtime"
	"strings"
)

const SDKVersion = "counted-go/2.0.0"

// canonicalOS maps anything to the closed set. Unrecognised becomes "other"
// rather than passing through, because a value that passes through is how one
// OS becomes four.
func canonicalOS(raw string) string {
	if raw == "" {
		return "other"
	}
	stripped := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		return -1
	}, raw)

	if mapped, ok := OsAliases[stripped]; ok {
		return mapped
	}
	return "other"
}

// DetectSystem reports the context every event carries.
func DetectSystem(appVersion string) map[string]any {
	raw := runtime.GOOS
	system := map[string]any{
		"os_name":     canonicalOS(raw),
		"os_version":  nil,
		"locale":      detectLocale(),
		"app_version": nil,
		"sdk_version": SDKVersion,
		// SDK-070: kept rather than discarded, so a platform nobody has
		// mapped yet is discoverable instead of silently becoming "other".
		"os_name_raw": raw,
	}
	if appVersion != "" {
		system["app_version"] = appVersion
	}
	return system
}

func detectLocale() any {
	for _, name := range []string{"LC_ALL", "LANG"} {
		if raw := os.Getenv(name); raw != "" {
			// "en_GB.UTF-8" is not a locale tag. Take the tag, drop the
			// encoding, and use the separator the wire expects.
			tag := strings.SplitN(raw, ".", 2)[0]
			return strings.ReplaceAll(tag, "_", "-")
		}
	}
	return nil
}
