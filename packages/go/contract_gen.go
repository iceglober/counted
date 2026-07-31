// Generated from contract/gen/contract.json. Do not edit.
// Run `bun run contract:generate` and commit the result.

package counted

const ContractVersion = "2026-08-01"

var OsNames = []string{"macos", "windows", "linux", "ios", "ipados", "android", "tvos", "watchos", "visionos", "chromeos", "freebsd", "other"}

var OsAliases = map[string]string{
	"macos": "macos",
	"macosx": "macos",
	"mac": "macos",
	"darwin": "macos",
	"osx": "macos",
	"windows": "windows",
	"win": "windows",
	"win32": "windows",
	"win64": "windows",
	"winnt": "windows",
	"linux": "linux",
	"gnulinux": "linux",
	"ubuntu": "linux",
	"debian": "linux",
	"fedora": "linux",
	"arch": "linux",
	"ios": "ios",
	"iphoneos": "ios",
	"iphone": "ios",
	"ipados": "ipados",
	"ipad": "ipados",
	"android": "android",
	"tvos": "tvos",
	"appletvos": "tvos",
	"watchos": "watchos",
	"visionos": "visionos",
	"xros": "visionos",
	"chromeos": "chromeos",
	"chromiumos": "chromeos",
	"cros": "chromeos",
	"freebsd": "freebsd",
	"openbsd": "freebsd",
	"netbsd": "freebsd",
	"other": "other",
	"unknown": "other",
}

const (
	FlushIntervalMs = 5000
	MaxBatchSize = 50
	MaxBufferEvents = 1000
	VisitTimeoutMs = 1800000
	RequestTimeoutMs = 15000
	MaxBodyBytes = 1048576
)

const (
	BackoffBaseMs = 500
	BackoffMaxMs  = 60000
	BackoffFactor = 2
)

var RetryableStatuses = []int{408, 425, 429, 500, 502, 503, 504}

var FatalStatuses = []int{401, 403}
