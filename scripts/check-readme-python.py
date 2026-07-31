"""Check the Python README's examples.

Python has no compile step that resolves attributes — `counted.trak(...)` parses
fine — so each block is *executed* against the real package. That is safe
because every block is given an empty key, which the SDK documents as a client
that starts no thread and performs no I/O.

Executed rather than merely parsed because the whole point is to catch a renamed
method or a changed keyword argument, and parsing catches neither.
"""

import pathlib
import runpy
import sys

blocks_dir = pathlib.Path(sys.argv[1])
package_dir = pathlib.Path(sys.argv[2])

# The package under test, not whatever `pip` has installed.
sys.path.insert(0, str(package_dir))

failed = 0
for path in sorted(blocks_dir.glob("block_*.py")):
    try:
        runpy.run_path(str(path), run_name="__readme__")
    except Exception as error:  # noqa: BLE001 — reporting is the job
        failed += 1
        print(f"{path.name}: {type(error).__name__}: {error}", file=sys.stderr)
        print(path.read_text(), file=sys.stderr)

sys.exit(1 if failed else 0)
