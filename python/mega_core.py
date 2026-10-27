# ==========================================================================
# Direct MEGA Decryption & Stream Engine (Python Edition)
# Native AES-128-CBC and AES-128-CTR decryption using official MEGA CS API
# ==========================================================================

import re
import base64
import struct
import json
import requests
from Crypto.Cipher import AES

def base64_url_decode(data: str) -> bytes:
    data = data.replace("-", "+").replace("_", "/")
    data += "=" * ((4 - len(data) % 4) % 4)
    return base64.b64decode(data)

def base64_to_a32(s: str) -> tuple:
    data = base64_url_decode(s)
    if len(data) % 4 != 0:
        data += b"\0" * (4 - len(data) % 4)
    return struct.unpack(">" + "I" * (len(data) // 4), data)

def a32_to_str(a: tuple) -> bytes:
    return struct.pack(">" + "I" * len(a), *a)

def aes_cbc_decrypt(data: bytes, key: bytes) -> bytes:
    cipher = AES.new(key, AES.MODE_CBC, b"\0" * 16)
    return cipher.decrypt(data)

def aes_cbc_decrypt_a32(data_a32: tuple, key_a32: tuple) -> tuple:
    data = a32_to_str(data_a32)
    key = a32_to_str(key_a32)
    dec = aes_cbc_decrypt(data, key)
    return struct.unpack(">" + "I" * (len(dec) // 4), dec)

def decrypt_key(k_a32: tuple, master_key_a32: tuple) -> tuple:
    res = []
    for i in range(0, len(k_a32), 4):
        chunk = k_a32[i:i + 4]
        res.extend(aes_cbc_decrypt_a32(chunk, master_key_a32))
    return tuple(res)

def decrypt_attr(attr_b64: str, key_a32: tuple) -> dict:
    try:
        raw = base64_url_decode(attr_b64)
        dec = aes_cbc_decrypt(raw, a32_to_str(key_a32))
        dec = dec.rstrip(b"\0")
        if dec.startswith(b'MEGA{"'):
            return json.loads(dec[4:].decode("utf-8", errors="ignore"))
    except Exception:
        pass
    return {}

def parse_mega_url(url: str):
    url = url.strip()
    m = re.search(r"/folder/([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)", url)
    if m:
        return "folder", m.group(1), m.group(2)
        
    m = re.search(r"/file/([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)", url)
    if m:
        return "file", m.group(1), m.group(2)

    m = re.search(r"/#F!([a-zA-Z0-9_-]+)!([a-zA-Z0-9_-]+)", url)
    if m:
        return "folder", m.group(1), m.group(2)

    m = re.search(r"/#!([a-zA-Z0-9_-]+)!([a-zA-Z0-9_-]+)", url)
    if m:
        return "file", m.group(1), m.group(2)

    return None, None, None

def resolve_mega(url: str) -> dict:
    kind, item_id, item_key = parse_mega_url(url)
    if not kind or not item_id or not item_key:
        raise ValueError("Invalid MEGA link or missing decryption key fragment (#...).")

    master_key_a32 = base64_to_a32(item_key)

    if kind == "folder":
        api_url = f"https://g.api.mega.co.nz/cs?n={item_id}"
        req_payload = [{"a": "f", "c": 1, "r": 1, "ca": 1}]
        resp = requests.post(api_url, json=req_payload, timeout=25)
        if not resp.ok:
            raise RuntimeError(f"MEGA API returned HTTP {resp.status_code}")
        data = resp.json()

        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], int) and data[0] < 0:
            code = data[0]
            if code == -9: raise RuntimeError("Folder not found or has been removed on MEGA.")
            if code == -16: raise RuntimeError("This account or folder is blocked by MEGA.")
            raise RuntimeError(f"MEGA API error code: {code}")

        if not isinstance(data, list) or len(data) == 0 or "f" not in data[0]:
            raise RuntimeError("Unexpected response structure from MEGA API.")

        nodes = data[0]["f"]
        node_map = {n["h"]: n for n in nodes}

        root_name = "MEGA Folder"
        for n in nodes:
            if n.get("t") == 1 and n.get("h") == item_id and "k" in n and ":" in n["k"]:
                k_enc = n["k"].split(":")[1]
                k_dec = decrypt_key(base64_to_a32(k_enc), master_key_a32)
                meta = decrypt_attr(n.get("a", ""), k_dec)
                if meta.get("n"):
                    root_name = meta["n"]
                    break

        def get_parent_path(node_h):
            path_parts = []
            curr = node_map.get(node_h)
            visited = set()
            while curr and curr.get("p") and curr["p"] in node_map and curr["p"] not in visited:
                visited.add(curr["p"])
                parent = node_map[curr["p"]]
                if parent.get("t") == 1 and "k" in parent and ":" in parent["k"]:
                    try:
                        k_enc = parent["k"].split(":")[1]
                        k_dec = decrypt_key(base64_to_a32(k_enc), master_key_a32)
                        meta = decrypt_attr(parent.get("a", ""), k_dec)
                        p_name = meta.get("n")
                        if p_name and p_name != root_name:
                            path_parts.append(p_name)
                    except Exception:
                        pass
                curr = parent
            path_parts.reverse()
            return "/".join(path_parts)

        files_list = []
        total_size = 0
        for n in nodes:
            if n.get("t") == 0 and "k" in n and ":" in n["k"]:
                try:
                    k_enc = n["k"].split(":")[1]
                    k_a32 = base64_to_a32(k_enc)
                    k_dec = decrypt_key(k_a32, master_key_a32)
                    if len(k_dec) >= 8:
                        attr_key = (
                            k_dec[0] ^ k_dec[4],
                            k_dec[1] ^ k_dec[5],
                            k_dec[2] ^ k_dec[6],
                            k_dec[3] ^ k_dec[7],
                        )
                    else:
                        attr_key = k_dec

                    meta = decrypt_attr(n.get("a", ""), attr_key)
                    file_name = meta.get("n", "unnamed_file")
                    file_size = int(n.get("s", 0))
                    total_size += file_size

                    folder_prefix = get_parent_path(n["h"])
                    rel_path = f"{folder_prefix}/{file_name}" if folder_prefix else file_name

                    files_list.append({
                        "node_id": n["h"],
                        "name": file_name,
                        "path": rel_path,
                        "size": file_size,
                        "folder_id": item_id,
                        "key_a32": k_dec,
                        "attr_key_a32": attr_key
                    })
                except Exception:
                    continue

        return {
            "kind": "folder",
            "name": root_name,
            "total_files": len(files_list),
            "total_size": total_size,
            "files": files_list
        }
    else:
        api_url = "https://g.api.mega.co.nz/cs"
        req_payload = [{"a": "g", "g": 1, "ssl": 2, "p": item_id}]
        resp = requests.post(api_url, json=req_payload, timeout=25)
        if not resp.ok:
            raise RuntimeError(f"MEGA API returned HTTP {resp.status_code}")
        data = resp.json()

        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], int) and data[0] < 0:
            code = data[0]
            if code == -9: raise RuntimeError("File not found or removed on MEGA.")
            if code == -16: raise RuntimeError("File is blocked by MEGA.")
            raise RuntimeError(f"MEGA API error code: {code}")

        file_meta = data[0]
        file_size = int(file_meta.get("s", 0))

        if len(master_key_a32) >= 8:
            attr_key = (
                master_key_a32[0] ^ master_key_a32[4],
                master_key_a32[1] ^ master_key_a32[5],
                master_key_a32[2] ^ master_key_a32[6],
                master_key_a32[3] ^ master_key_a32[7],
            )
        else:
            attr_key = master_key_a32

        meta = decrypt_attr(file_meta.get("at", ""), attr_key)
        file_name = meta.get("n", "mega_file")

        return {
            "kind": "file",
            "name": file_name,
            "total_files": 1,
            "total_size": file_size,
            "files": [{
                "node_id": item_id,
                "name": file_name,
                "path": file_name,
                "size": file_size,
                "folder_id": None,
                "key_a32": master_key_a32,
                "attr_key_a32": attr_key
            }]
        }
