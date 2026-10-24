import { describe, expect, it } from "vitest";
import { isDartsHealth, localScanHosts, probe, resolveServer, sameOrigin, scanServers, serverCandidates } from "./net";

const health = { status: "ok", version: "1.12.0", schemaVersion: 5, autodarts: "disabled" };

/** Faux réseau : seules les origines listées répondent. */
function fakeFetch(servers: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const origin = new URL(url).origin;
    if (!(origin in servers)) throw new Error("ECONNREFUSED");
    return { ok: true, json: async () => servers[origin] };
  };
  return { impl, calls };
}

describe("application Windows : adresse du serveur", () => {
  it("comprend les saisies courantes", () => {
    expect(serverCandidates("192.168.1.50")).toEqual(["http://192.168.1.50:8080", "http://192.168.1.50"]);
    expect(serverCandidates(" 192.168.1.50:8081 ")).toEqual(["http://192.168.1.50:8081"]);
    expect(serverCandidates("http://nas.local:8080/jouer?x=1")).toEqual(["http://nas.local:8080"]);
    expect(serverCandidates("https://darts.maison.fr")).toEqual(["https://darts.maison.fr", "https://darts.maison.fr:8080"]);
    expect(serverCandidates("HTTP://NAS:80")).toEqual(["http://nas"]);
  });

  it("refuse ce qui n'est pas une adresse web", () => {
    for (const bad of ["", "   ", "file:///C:/Windows", "javascript:alert(1)", "ftp://nas", "http://", "http://user:mdp@nas:8080", "nas:abc"]) {
      expect(serverCandidates(bad)).toEqual([]);
    }
  });

  it("ne reconnaît que la réponse de santé de DARTS EVOLUTION", () => {
    expect(isDartsHealth(health)).toBe(true);
    expect(isDartsHealth({ status: "ok" })).toBe(false);
    expect(isDartsHealth("<html>")).toBe(false);
    expect(isDartsHealth(null)).toBe(false);
  });

  it("essaie le port 8080 puis le port standard", async () => {
    const { impl, calls } = fakeFetch({ "http://192.168.1.50": health });
    expect(await resolveServer("192.168.1.50", impl)).toEqual({ url: "http://192.168.1.50", version: "1.12.0" });
    expect(calls).toEqual(["http://192.168.1.50:8080/api/health", "http://192.168.1.50/api/health"]);
    expect(await resolveServer("192.168.1.51", impl)).toBeNull();
  });

  it("un autre site web sur la même adresse n'est pas pris pour le serveur", async () => {
    const { impl } = fakeFetch({ "http://192.168.1.1:8080": { hello: "box internet" } });
    expect(await probe("http://192.168.1.1:8080", impl)).toBeNull();
  });

  it("parcourt les réseaux locaux privés uniquement", () => {
    const hosts = localScanHosts({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wifi: [
        { address: "192.168.1.23", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      eth: [{ address: "10.0.4.7", family: 4, internal: false }],
      vpn: [{ address: "100.64.0.3", family: "IPv4", internal: false }],
      public: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
    });
    expect(hosts).toHaveLength(508);
    expect(hosts[0]).toBe("192.168.1.1");
    expect(hosts).toContain("192.168.1.254");
    expect(hosts).toContain("10.0.4.1");
    expect(hosts.some((h) => h.startsWith("100.64.") || h.startsWith("8.8."))).toBe(false);
  });

  it("trouve les serveurs du réseau, triés par adresse", async () => {
    const { impl } = fakeFetch({ "http://192.168.1.120:8080": health, "http://192.168.1.9:8080": { ...health, version: "1.11.0" } });
    const hosts = Array.from({ length: 254 }, (_, i) => `192.168.1.${i + 1}`);
    expect(await scanServers(hosts, impl, { concurrency: 16 })).toEqual([
      { url: "http://192.168.1.9:8080", version: "1.11.0" },
      { url: "http://192.168.1.120:8080", version: "1.12.0" },
    ]);
  });

  it("compare les origines exactement", () => {
    expect(sameOrigin("http://192.168.1.50:8080/carriere/abc", "http://192.168.1.50:8080")).toBe(true);
    expect(sameOrigin("http://192.168.1.50:8081/", "http://192.168.1.50:8080")).toBe(false);
    expect(sameOrigin("https://192.168.1.50:8080/", "http://192.168.1.50:8080")).toBe(false);
    expect(sameOrigin("pas une adresse", "http://192.168.1.50:8080")).toBe(false);
  });
});
