"""Write the Windows-only guide images out of the git object store.

    python scripts/extract-windows-images.py

`git show <rev>:<path>` through PowerShell redirects mangles binary output, which
is how these two files ended up unreadable once. Reading the blob directly is the
only reliable path on Windows, so the extraction lives here instead of in a shell
one-liner. Run this from the repo root after checking the commit out, or pass a
revision.
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "docs" / "img"

# Source revision that holds the Windows page screenshot pair.
DEFAULT_REV = "2ef8a07"
FILES = {
    "windows-page.png": "docs/img/hero-shot.png",
    "windows-button.png": "docs/img/step-01-menu.png",
}


def main() -> None:
    rev = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REV
    for out_name, blob_path in FILES.items():
        data = subprocess.run(
            ["git", "show", f"{rev}:{blob_path}"],
            cwd=HERE,
            capture_output=True,
            check=True,
        ).stdout
        (OUT / out_name).write_bytes(data)
        print(f"{out_name}: {len(data)} bytes from {rev}:{blob_path}")


if __name__ == "__main__":
    main()
