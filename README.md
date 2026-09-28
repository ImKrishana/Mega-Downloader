## Mega Direct Link Generator

**Simple API to generate direct download links from MEGA files and folders.**

**[Live Demo](https://megadl.the-zake.workers.dev/)**

## API Usage

<details>
<summary><strong>Generate Direct Links</strong></summary>

```text
GET https://your-project.vercel.app/api/mega?url=MEGA_URL
```

Example:

```bash
curl --get "https://your-project.vercel.app/api/mega" \
  --data-urlencode "url=https://mega.nz/folder/#xxxx"
```

**Use `--data-urlencode` so the MEGA folder key is sent correctly.**

</details>

<details>
<summary><strong>Example Response</strong></summary>

```json
{
  "job_id": "XoX9QrZfkTSC",
  "state": "completed",
  "name": "Example Folder",
  "total_files": 10,
  "completed_files": 10,
  "failed_files": 0,
  "zip_url": "https://example.com/download.zip",
  "files": [
    {
      "name": "video.mp4",
      "size": 1048576,
      "state": "done",
      "download_url": "https://example.com/video.mp4"
    }
  ]
}
```

</details>

<details>
<summary><strong>Check Status</strong></summary>

**If the request is still processing, copy the returned `job_id` and use:**

```text
GET https://your-project.vercel.app/api/mega/status?id=JOB_ID
```

</details>

<details>
<summary><strong>Response States</strong></summary>

- `pending` - **Request is waiting to start or update**
- `processing` - **Files are being processed**
- `completed` - **Files are ready**
- `partial` - **Some files were not available**
- `failed` - **Request failed**
- `expired` - **Job or links expired**

`200` **means the job reached a final state.**

`202` **means the job is still processing. Use the status endpoint again.**

</details>

## Usage Examples

<details>
<summary><strong>Python</strong></summary>

```python
import time
import requests

API_URL = "https://your-project.vercel.app"
MEGA_URL = "https://mega.nz/folder/#xxxx"

response = requests.get(
    f"{API_URL}/api/mega",
    params={"url": MEGA_URL},
    timeout=60,
)
result = response.json()

while result.get("state") in ["pending", "processing"]:
    time.sleep(3)
    status = requests.get(
        f"{API_URL}/api/mega/status",
        params={"id": result["job_id"]},
        timeout=30,
    )
    result = status.json()

print(result.get("zip_url"))
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const API_URL = "https://your-project.vercel.app";
const MEGA_URL = "https://mega.nz/folder/#xxxx";

let response = await fetch(
  `${API_URL}/api/mega?url=${encodeURIComponent(MEGA_URL)}`
);
let result = await response.json();

while (["pending", "processing"].includes(result.state)) {
  await new Promise(resolve => setTimeout(resolve, 3000));

  response = await fetch(
    `${API_URL}/api/mega/status?id=${encodeURIComponent(result.job_id)}`
  );
  result = await response.json();
}

console.log(result.zip_url);
```

</details>

## Deployment

<details>
<summary><strong>Deploy on Vercel</strong></summary>

**1. Fork this Repo**

**2. Import the GitHub repository into Vercel.**

**3. Keep the project root at the repository root.**

**4. Select the `main` branch.**

**5. Deploy the project.**

</details>

## Credits

<div align="center">

<strong>K R I $ H A N A</strong> · <a href="https://github.com/ImKrishana">@ImKrishana</a>

<strong>◤𝑺 𝑨 𝑻  𝒀 𝑨 𝑴 ◢</strong> · <a href="https://github.com/ftsatyam">@ftsatyam</a>

<strong>Reference</strong> · <a href="https://clonr.co">clonr</a>

</div>

---

<details>
<summary><strong>Disclaimer</strong></summary>

**This project is provided for educational and research purposes only.**

**The project developer is not responsible for misuse of this API.**

</details>

---
