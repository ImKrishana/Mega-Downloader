// ==========================================================================
// Direct MEGA Decryption & Stream Engine (Node.js Native)
// Zero-dependency pure JavaScript implementation of MEGA API & AES-128 crypto
// ==========================================================================

import crypto from 'node:crypto';

export function base64UrlDecode(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Buffer.from(s, 'base64');
}

export function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bufferToA32(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  if (pad > 0) buf = Buffer.concat([buf, Buffer.alloc(pad)]);
  const a32 = new Uint32Array(buf.length / 4);
  for (let i = 0; i < a32.length; i++) {
    a32[i] = buf.readUInt32BE(i * 4);
  }
  return a32;
}

export function a32ToBuffer(a32) {
  const buf = Buffer.alloc(a32.length * 4);
  for (let i = 0; i < a32.length; i++) {
    buf.writeUInt32BE(a32[i], i * 4);
  }
  return buf;
}

export function aesCbcDecrypt(dataBuf, keyBuf) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(dataBuf), decipher.final()]);
}

export function decryptKey(kA32, masterKeyA32) {
  const res = [];
  for (let i = 0; i < kA32.length; i += 4) {
    const chunk = kA32.slice(i, i + 4);
    const dec = aesCbcDecrypt(a32ToBuffer(chunk), a32ToBuffer(masterKeyA32));
    const decA32 = bufferToA32(dec);
    for (let j = 0; j < decA32.length; j++) res.push(decA32[j]);
  }
  return new Uint32Array(res);
}

export function decryptAttr(attrB64, keyA32) {
  try {
    const raw = base64UrlDecode(attrB64);
    const dec = aesCbcDecrypt(raw, a32ToBuffer(keyA32));
    const str = dec.toString('utf8');
    const idx = str.indexOf('MEGA{"');
    if (idx !== -1) {
      const jsonStr = str.substring(idx + 4);
      const end = jsonStr.lastIndexOf('}');
      if (end !== -1) return JSON.parse(jsonStr.substring(0, end + 1));
    }
  } catch {
    // ignore
  }
  return {};
}

export function parseMegaUrl(rawUrl) {
  const url = String(rawUrl || '').trim();

  // Modern folder format: /folder/ID#KEY
  let m = url.match(/\/folder\/([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)/);
  if (m) return { kind: 'folder', id: m[1], key: m[2] };

  // Modern file format: /file/ID#KEY
  m = url.match(/\/file\/([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)/);
  if (m) return { kind: 'file', id: m[1], key: m[2] };

  // Legacy folder format: /#F!ID!KEY
  m = url.match(/\/#F!([a-zA-Z0-9_-]+)!([a-zA-Z0-9_-]+)/);
  if (m) return { kind: 'folder', id: m[1], key: m[2] };

  // Legacy file format: /#!ID!KEY
  m = url.match(/\/#\!([a-zA-Z0-9_-]+)!([a-zA-Z0-9_-]+)/);
  if (m) return { kind: 'file', id: m[1], key: m[2] };

  return null;
}

export async function resolveMega(rawUrl) {
  const parsed = parseMegaUrl(rawUrl);
  if (!parsed) {
    throw new Error('Invalid MEGA URL. Expected https://mega.nz/folder/... or https://mega.nz/file/...');
  }

  const { kind, id, key } = parsed;
  const masterKeyA32 = bufferToA32(base64UrlDecode(key));

  if (kind === 'folder') {
    const apiUrl = `https://g.api.mega.co.nz/cs?n=${id}`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ a: 'f', c: 1, r: 1, ca: 1 }])
    });

    if (!res.ok) {
      throw new Error(`MEGA API error HTTP ${res.status}`);
    }

    const data = await res.json();
    if (Array.isArray(data) && typeof data[0] === 'number' && data[0] < 0) {
      const code = data[0];
      if (code === -9) throw new Error('MEGA folder not found or has been removed.');
      if (code === -16) throw new Error('MEGA account or folder is blocked.');
      throw new Error(`MEGA API error code: ${code}`);
    }

    if (!Array.isArray(data) || !data[0] || !Array.isArray(data[0].f)) {
      throw new Error('Unexpected response structure from MEGA API.');
    }

    const nodes = data[0].f;
    const nodeMap = new Map();
    for (const n of nodes) nodeMap.set(n.h, n);

    let rootName = 'MEGA Folder';
    for (const n of nodes) {
      if (n.t === 1 && n.h === id && n.k && n.k.includes(':')) {
        const kEnc = n.k.split(':')[1];
        const kDec = decryptKey(bufferToA32(base64UrlDecode(kEnc)), masterKeyA32);
        const meta = decryptAttr(n.a, kDec);
        if (meta.n) {
          rootName = meta.n;
          break;
        }
      }
    }

    function getParentPath(nodeH) {
      const parts = [];
      let curr = nodeMap.get(nodeH);
      const visited = new Set();
      while (curr && curr.p && nodeMap.has(curr.p) && !visited.has(curr.p)) {
        visited.add(curr.p);
        const parent = nodeMap.get(curr.p);
        if (parent && parent.t === 1 && parent.k && parent.k.includes(':')) {
          try {
            const kEnc = parent.k.split(':')[1];
            const kDec = decryptKey(bufferToA32(base64UrlDecode(kEnc)), masterKeyA32);
            const meta = decryptAttr(parent.a, kDec);
            if (meta.n && meta.n !== rootName) parts.push(meta.n);
          } catch {}
        }
        curr = parent;
      }
      parts.reverse();
      return parts.join('/');
    }

    const files = [];
    let totalSize = 0;

    for (const n of nodes) {
      if (n.t === 0 && n.k && n.k.includes(':')) {
        try {
          const kEnc = n.k.split(':')[1];
          const kDec = decryptKey(bufferToA32(base64UrlDecode(kEnc)), masterKeyA32);
          let attrKey = kDec;
          if (kDec.length >= 8) {
            attrKey = new Uint32Array([
              kDec[0] ^ kDec[4],
              kDec[1] ^ kDec[5],
              kDec[2] ^ kDec[6],
              kDec[3] ^ kDec[7]
            ]);
          }

          const meta = decryptAttr(n.a, attrKey);
          const name = meta.n || 'unnamed_file';
          const size = Number(n.s || 0);
          totalSize += size;

          const folderPrefix = getParentPath(n.h);
          const path = folderPrefix ? `${folderPrefix}/${name}` : name;
          const kDecB64 = base64UrlEncode(a32ToBuffer(kDec));

          files.push({
            node_id: n.h,
            name,
            path,
            size,
            folder_id: id,
            download_token: kDecB64
          });
        } catch {}
      }
    }

    return {
      kind: 'folder',
      name: rootName,
      total_files: files.length,
      total_size: totalSize,
      files
    };
  } else {
    // Single file
    const res = await fetch('https://g.api.mega.co.nz/cs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ a: 'g', g: 1, ssl: 2, p: id }])
    });

    if (!res.ok) throw new Error(`MEGA API error HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && typeof data[0] === 'number' && data[0] < 0) {
      const code = data[0];
      if (code === -9) throw new Error('MEGA file not found or removed.');
      if (code === -16) throw new Error('MEGA account or file is blocked.');
      throw new Error(`MEGA API error code: ${code}`);
    }

    const metaNode = data[0];
    const size = Number(metaNode.s || 0);

    let attrKey = masterKeyA32;
    if (masterKeyA32.length >= 8) {
      attrKey = new Uint32Array([
        masterKeyA32[0] ^ masterKeyA32[4],
        masterKeyA32[1] ^ masterKeyA32[5],
        masterKeyA32[2] ^ masterKeyA32[6],
        masterKeyA32[3] ^ masterKeyA32[7]
      ]);
    }

    const meta = decryptAttr(metaNode.at, attrKey);
    const name = meta.n || 'mega_file';
    const keyB64 = base64UrlEncode(a32ToBuffer(masterKeyA32));

    return {
      kind: 'file',
      name,
      total_files: 1,
      total_size: size,
      files: [{
        node_id: id,
        name,
        path: name,
        size,
        folder_id: null,
        download_token: keyB64
      }]
    };
  }
}

export async function getDecryptedDownloadStream({ folderId, nodeId, token }) {
  const kDecBuf = base64UrlDecode(token);
  const kDec = bufferToA32(kDecBuf);

  const fileKey = a32ToBuffer(new Uint32Array([
    kDec[0] ^ kDec[4],
    kDec[1] ^ kDec[5],
    kDec[2] ^ kDec[6],
    kDec[3] ^ kDec[7]
  ]));
  const iv = Buffer.concat([a32ToBuffer(new Uint32Array([kDec[4], kDec[5]])), Buffer.alloc(8)]);

  const apiUrl = folderId ? `https://g.api.mega.co.nz/cs?n=${folderId}` : 'https://g.api.mega.co.nz/cs';
  const reqPayload = folderId 
    ? [{ a: 'g', g: 1, ssl: 2, n: nodeId }]
    : [{ a: 'g', g: 1, ssl: 2, p: nodeId }];

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqPayload)
  });

  if (!res.ok) throw new Error(`MEGA CS HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data) && typeof data[0] === 'number' && data[0] < 0) {
    throw new Error(`MEGA download error code: ${data[0]}`);
  }

  const directUrl = data[0].g;
  const fileSize = Number(data[0].s || 0);

  const megaResp = await fetch(directUrl);
  if (!megaResp.ok) throw new Error(`MEGA Storage cluster HTTP ${megaResp.status}`);

  const decipher = crypto.createDecipheriv('aes-128-ctr', fileKey, iv);
  const transform = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(decipher.update(chunk));
    },
    flush(controller) {
      const final = decipher.final();
      if (final.length > 0) controller.enqueue(final);
    }
  });

  return {
    stream: megaResp.body.pipeThrough(transform),
    fileSize
  };
}
