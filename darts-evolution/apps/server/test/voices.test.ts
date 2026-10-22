import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { decodeMsAdpcm, normalizeAudio, pcm16Wav, wavInfo } from "../src/update/wav.js";
import { writeZip } from "../src/update/zip.js";
import { removeDir, startTestApp, type TestApp } from "./helpers.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const tone = (n = 2000) => pcm16Wav(Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 8) * 8000)), 1, 22050);

const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
    removeDir(app.dir);
  }
});

describe("audio des packs de voix", () => {
  it("décode le Microsoft ADPCM à l'identique de FFmpeg (mono et stéréo)", () => {
    for (const name of ["adpcm-mono", "adpcm-stereo"]) {
      const { samples, channels } = decodeMsAdpcm(fixture(`${name}.wav`));
      const ref = fixture(`${name}.pcm`);
      const expected = new Int16Array(ref.buffer.slice(ref.byteOffset, ref.byteOffset + ref.byteLength));
      expect(channels).toBe(name === "adpcm-mono" ? 1 : 2);
      // FFmpeg rend des blocs entiers ; le décodeur s'arrête à la durée réelle (bloc « fact »).
      expect(samples.length).toBeGreaterThan(expected.length * 0.75);
      expect(samples.length).toBeLessThanOrEqual(expected.length);
      expect(Array.from(samples)).toEqual(Array.from(expected.subarray(0, samples.length)));
    }
  });

  it("convertit l'ADPCM en PCM, conserve le PCM et refuse les fichiers illisibles", () => {
    const converted = normalizeAudio("gameon.wav", fixture("adpcm-stereo.wav"));
    expect(converted.converted).toBe(true);
    expect(wavInfo(converted.data)).toMatchObject({ format: 1, channels: 2, bitsPerSample: 16 });
    const kept = normalizeAudio("26.WAV", tone());
    expect(kept).toMatchObject({ ext: "wav", converted: false });
    expect(() => normalizeAudio("x.wav", Buffer.from("pas du tout un wav, juste du texte"))).toThrow();
    expect(() => normalizeAudio("x.mp3", Buffer.from("texte"))).toThrow();
  });
});

describe("packs de voix", () => {
  function pack() {
    return writeZip([
      { name: "0.wav", data: tone() },
      { name: "26.wav", data: tone() },
      { name: "180.wav", data: tone(4000) },
      { name: "gameon.wav", data: fixture("adpcm-mono.wav") },
      { name: "1st.wav", data: tone(3000) },
      { name: "lisez-moi.txt", data: Buffer.from("texte") },
      { name: "abime.wav", data: Buffer.from("RIFF0000WAVEcorrompu") },
    ]);
  }

  it("importe un pack : scores par nom de fichier, rôles reconnus, conversion et fichiers ignorés", async () => {
    const app = await startTestApp();
    apps.push(app);
    const res = await app.request("POST", "/api/voices?name=Russ%20Bray", pack(), { "content-type": "application/octet-stream" });
    expect(res.statusCode).toBe(201);
    const { pack: p, converted, skipped } = res.json();
    expect(p).toMatchObject({ name: "Russ Bray", scores: 3, roles: { gameon: "gameon" }, others: ["1st", "gameon"] });
    expect(p.missingScores).toContain(60);
    expect(p.missingScores).not.toContain(179); // score impossible : jamais « manquant »
    expect(converted).toEqual(["gameon.wav"]);
    expect(skipped.map((s: any) => s.file).sort()).toEqual(["abime.wav", "lisez-moi.txt"]);

    const file = await app.request("GET", `/api/voices/${p.id}/files/gameon`);
    expect(file.headers["content-type"]).toBe("audio/wav");
    expect(file.headers["cache-control"]).toContain("immutable");
    expect(wavInfo(file.rawPayload).format).toBe(1);
    expect((await app.request("GET", `/api/voices/${p.id}/files/999`)).statusCode).toBe(404);
    expect((await app.request("GET", `/api/voices/..%2F..%2Fdata/files/0`)).statusCode).toBe(404);

    const roles = await app.json("PUT", `/api/voices/${p.id}/roles`, { leg: "1st", bust: "0" });
    expect(roles.roles).toEqual({ gameon: "gameon", leg: "1st", bust: "0" });
    expect((await app.request("PUT", `/api/voices/${p.id}/roles`, { match: "inconnu" })).statusCode).toBe(400);
    expect((await app.json("GET", "/api/voices")).map((v: any) => v.id)).toEqual([p.id]);

    expect((await app.request("DELETE", `/api/voices/${p.id}`)).statusCode).toBe(204);
    expect(await app.json("GET", "/api/voices")).toEqual([]);
  });

  it("réserve l'import à l'administrateur quand un mot de passe est défini", async () => {
    const app = await startTestApp({ ADMIN_PASSWORD: "secret-test" });
    apps.push(app);
    expect((await app.request("POST", "/api/voices", pack(), { "content-type": "application/octet-stream" })).statusCode).toBe(401);
    expect((await app.request("POST", "/api/voices", writeZip([{ name: "a.txt", data: Buffer.from("x") }]), { "content-type": "application/octet-stream" })).statusCode).toBe(401);
  });

  it("refuse une archive sans aucun son", async () => {
    const app = await startTestApp();
    apps.push(app);
    const res = await app.request("POST", "/api/voices", writeZip([{ name: "a.txt", data: Buffer.from("x") }]), { "content-type": "application/octet-stream" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Aucun fichier audio/);
  });
});
