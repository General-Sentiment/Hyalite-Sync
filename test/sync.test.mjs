import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  slugify,
  findCandidates,
  buildSlugMap,
  normalizeWikiLinks,
  resolveFrontmatterWikiLinks,
  syncMedia,
  syncFile,
  sync,
  loadConfig,
} from "../src/index.mjs";

// ── slugify ──────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    assert.equal(slugify("Hello World"), "hello-world");
  });

  it("strips non-word characters", () => {
    assert.equal(slugify("What's up?"), "whats-up");
  });

  it("collapses multiple hyphens", () => {
    assert.equal(slugify("a -- b --- c"), "a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    assert.equal(slugify("--hello--"), "hello");
  });

  it("handles underscores", () => {
    assert.equal(slugify("snake_case"), "snake_case");
  });

  it("returns empty string for empty input", () => {
    assert.equal(slugify(""), "");
  });
});

// ── normalizeWikiLinks ───────────────────────────────────────

describe("normalizeWikiLinks", () => {
  const slugMap = new Map([
    ["some note", "some-note"],
    ["another page", "another-page"],
  ]);

  it("converts basic wiki-link", () => {
    const result = normalizeWikiLinks("See [[Some Note]] for details", slugMap);
    assert.equal(result, "See [Some Note](/some-note) for details");
  });

  it("converts wiki-link with display text", () => {
    const result = normalizeWikiLinks("See [[Another Page|click here]]", slugMap);
    assert.equal(result, "See [click here](/another-page)");
  });

  it("falls back to slugified target when not in map", () => {
    const result = normalizeWikiLinks("See [[Unknown Page]]", slugMap);
    assert.equal(result, "See [Unknown Page](/unknown-page)");
  });

  it("handles multiple wiki-links in one line", () => {
    const result = normalizeWikiLinks("[[Some Note]] and [[Another Page]]", slugMap);
    assert.equal(result, "[Some Note](/some-note) and [Another Page](/another-page)");
  });
});

// ── resolveFrontmatterWikiLinks ─────────────────────────────

describe("resolveFrontmatterWikiLinks", () => {
  let vaultDir, mediaDir;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
    mediaDir = mkdtempSync(join(tmpdir(), "media-"));
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true });
    rmSync(mediaDir, { recursive: true });
  });

  it("resolves a media wiki-link to /media/ path and copies the file", () => {
    const imgPath = join(vaultDir, "cover.png");
    writeFileSync(imgPath, "fake-image-data");
    const filePath = join(vaultDir, "note.md");

    const result = resolveFrontmatterWikiLinks(
      { image: "[[cover.png]]" },
      new Map(),
      filePath,
      vaultDir,
      mediaDir
    );

    assert.equal(result.image, "/media/cover.png");
    assert.ok(existsSync(join(mediaDir, "cover.png")));
  });

  it("resolves a non-media wiki-link using the slug map", () => {
    const filePath = join(vaultDir, "note.md");
    const slugMap = new Map([["other note", "other-note"]]);

    const result = resolveFrontmatterWikiLinks(
      { related: "[[Other Note]]" },
      slugMap,
      filePath,
      vaultDir,
      mediaDir
    );

    assert.equal(result.related, "/other-note");
  });

  it("resolves wiki-links inside arrays", () => {
    const imgPath = join(vaultDir, "photo.jpg");
    writeFileSync(imgPath, "fake-jpg");
    const filePath = join(vaultDir, "note.md");

    const result = resolveFrontmatterWikiLinks(
      { gallery: ["[[photo.jpg]]", "[[Missing Page]]"] },
      new Map(),
      filePath,
      vaultDir,
      mediaDir
    );

    assert.equal(result.gallery[0], "/media/photo.jpg");
    assert.equal(result.gallery[1], "/missing-page");
  });

  it("resolves wiki-links inside nested objects", () => {
    const imgPath = join(vaultDir, "hero.webp");
    writeFileSync(imgPath, "fake-webp");
    const filePath = join(vaultDir, "note.md");

    const result = resolveFrontmatterWikiLinks(
      { meta: { cover: "[[hero.webp]]" } },
      new Map(),
      filePath,
      vaultDir,
      mediaDir
    );

    assert.equal(result.meta.cover, "/media/hero.webp");
  });

  it("strips media/ prefix from vault media paths", () => {
    mkdirSync(join(vaultDir, "media"));
    const imgPath = join(vaultDir, "media", "photo.png");
    writeFileSync(imgPath, "fake-image");
    const filePath = join(vaultDir, "note.md");

    const result = resolveFrontmatterWikiLinks(
      { image: "[[media/photo.png]]" },
      new Map(),
      filePath,
      vaultDir,
      mediaDir
    );

    assert.equal(result.image, "/media/photo.png");
    assert.ok(existsSync(join(mediaDir, "photo.png")));
  });

  it("leaves non-string values unchanged", () => {
    const filePath = join(vaultDir, "note.md");

    const result = resolveFrontmatterWikiLinks(
      { count: 42, active: true, date: new Date("2025-01-01") },
      new Map(),
      filePath,
      vaultDir,
      mediaDir
    );

    assert.equal(result.count, 42);
    assert.equal(result.active, true);
    assert.ok(result.date instanceof Date);
  });
});

// ── findCandidates ───────────────────────────────────────────

describe("findCandidates", () => {
  let vaultDir;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
    writeFileSync(
      join(vaultDir, "public-note.md"),
      "---\ntitle: Public\npublic: true\n---\nHello"
    );
    writeFileSync(
      join(vaultDir, "private-note.md"),
      "---\ntitle: Private\npublic: false\n---\nSecret"
    );
    writeFileSync(
      join(vaultDir, "no-frontmatter.md"),
      "Just some text"
    );
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true });
  });

  it("finds files with public: true", () => {
    const results = findCandidates(vaultDir, { public: true });
    assert.equal(results.length, 1);
    assert.ok(results[0].includes("public-note.md"));
  });

  it("returns empty array when no matches", () => {
    const results = findCandidates(vaultDir, { project: "nonexistent" });
    assert.equal(results.length, 0);
  });
});

// ── buildSlugMap ─────────────────────────────────────────────

describe("buildSlugMap", () => {
  let vaultDir;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true });
  });

  it("maps filename and title to slug", () => {
    const filePath = join(vaultDir, "My Note.md");
    writeFileSync(filePath, "---\ntitle: My Great Note\n---\nContent");

    const map = buildSlugMap([filePath]);
    assert.equal(map.get("my note"), "my-great-note");
    assert.equal(map.get("my great note"), "my-great-note");
  });

  it("prefers slug field over title", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: My Title\nslug: custom-slug\n---\nContent");

    const map = buildSlugMap([filePath]);
    assert.equal(map.get("note"), "custom-slug");
  });

  it("falls back to filename when no title", () => {
    const filePath = join(vaultDir, "some-file.md");
    writeFileSync(filePath, "---\npublic: true\n---\nContent");

    const map = buildSlugMap([filePath]);
    assert.equal(map.get("some-file"), "some-file");
  });
});

// ── syncFile ─────────────────────────────────────────────────

describe("syncFile", () => {
  let vaultDir, contentDir, mediaDir;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
    contentDir = mkdtempSync(join(tmpdir(), "content-"));
    mediaDir = mkdtempSync(join(tmpdir(), "media-"));
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true });
    rmSync(contentDir, { recursive: true });
    rmSync(mediaDir, { recursive: true });
  });

  it("syncs a public file and returns slug", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: Test Note\npublic: true\n---\nHello world");

    const slug = syncFile(filePath, vaultDir, new Map(), {
      contentDir,
      mediaDir,
    });

    assert.equal(slug, "test-note");
    assert.ok(existsSync(join(contentDir, "test-note.md")));
  });

  it("returns null for non-public files", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: Private\npublic: false\n---\nSecret");

    const slug = syncFile(filePath, vaultDir, new Map(), {
      contentDir,
      mediaDir,
    });

    assert.equal(slug, null);
  });

  it("strips configured fields from output frontmatter", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(
      filePath,
      "---\ntitle: Note\npublic: true\ndraft: true\n---\nContent"
    );

    syncFile(filePath, vaultDir, new Map(), {
      contentDir,
      mediaDir,
      stripFields: ["draft"],
    });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(!output.includes("draft:"));
    assert.ok(!output.includes("public:"));
    assert.ok(output.includes("title:"));
  });

  it("resolves wiki-links in content", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: Note\npublic: true\n---\nSee [[Other]]");

    const slugMap = new Map([["other", "other-page"]]);
    syncFile(filePath, vaultDir, slugMap, { contentDir, mediaDir });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(output.includes("[Other](/other-page)"));
  });

  it("resolves media wiki-links in frontmatter", () => {
    const imgPath = join(vaultDir, "banner.png");
    writeFileSync(imgPath, "fake-image");
    const filePath = join(vaultDir, "note.md");
    writeFileSync(
      filePath,
      "---\ntitle: Note\npublic: true\ncover: \"[[banner.png]]\"\n---\nContent"
    );

    syncFile(filePath, vaultDir, new Map(), { contentDir, mediaDir });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(output.includes("cover: /media/banner.png"));
    assert.ok(existsSync(join(mediaDir, "banner.png")));
  });

  it("resolves non-media wiki-links in frontmatter", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(
      filePath,
      "---\ntitle: Note\npublic: true\nrelated: \"[[Some Page]]\"\n---\nContent"
    );

    const slugMap = new Map([["some page", "some-page"]]);
    syncFile(filePath, vaultDir, slugMap, { contentDir, mediaDir });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(output.includes("related: /some-page"));
  });

  it("adds computed fields from config", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: Note\npublic: true\n---\nContent");

    syncFile(filePath, vaultDir, new Map(), {
      contentDir,
      mediaDir,
      computedFields: { updated: "file.mtime" },
    });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(output.includes("updated:"));
  });

  it("supports literal values in computed fields", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: Note\npublic: true\n---\nContent");

    syncFile(filePath, vaultDir, new Map(), {
      contentDir,
      mediaDir,
      computedFields: { layout: "post" },
    });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(output.includes("layout: post"));
  });

  it("does not add updated field without computedFields config", () => {
    const filePath = join(vaultDir, "note.md");
    writeFileSync(filePath, "---\ntitle: Note\npublic: true\n---\nContent");

    syncFile(filePath, vaultDir, new Map(), { contentDir, mediaDir });

    const output = readFileSync(join(contentDir, "note.md"), "utf-8");
    assert.ok(!output.includes("updated:"));
  });
});

// ── sync (full pipeline) ────────────────────────────────────

describe("sync", () => {
  let vaultDir, contentDir, mediaDir;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
    contentDir = mkdtempSync(join(tmpdir(), "content-"));
    mediaDir = mkdtempSync(join(tmpdir(), "media-"));
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true });
    rmSync(contentDir, { recursive: true });
    rmSync(mediaDir, { recursive: true });
  });

  it("syncs all public files from vault", () => {
    writeFileSync(
      join(vaultDir, "a.md"),
      "---\ntitle: Alpha\npublic: true\n---\nFirst"
    );
    writeFileSync(
      join(vaultDir, "b.md"),
      "---\ntitle: Beta\npublic: true\n---\nSecond"
    );
    writeFileSync(
      join(vaultDir, "c.md"),
      "---\ntitle: Gamma\npublic: false\n---\nThird"
    );

    sync({ vaultPath: vaultDir, contentDir, mediaDir });

    assert.ok(existsSync(join(contentDir, "alpha.md")));
    assert.ok(existsSync(join(contentDir, "beta.md")));
    assert.ok(!existsSync(join(contentDir, "gamma.md")));
  });
});

// ── loadConfig ───────────────────────────────────────────────

describe("loadConfig", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "config-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("loads config from a JSON file", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ vaultPath: "/tmp/vault", contentDir: "./out" })
    );

    const config = loadConfig(configPath);
    assert.equal(config.vaultPath, "/tmp/vault");
    assert.ok(config.contentDir.endsWith("out"));
  });

  it("throws when no vault path is provided", () => {
    const origEnv = process.env.OBSIDIAN_VAULT;
    delete process.env.OBSIDIAN_VAULT;

    assert.throws(() => loadConfig(null, {}), /Vault path required/);

    if (origEnv) process.env.OBSIDIAN_VAULT = origEnv;
  });

  it("merges overrides with file config", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ vaultPath: "/tmp/vault", contentDir: "./original" })
    );

    const config = loadConfig(configPath, { contentDir: "./override" });
    assert.ok(config.contentDir.endsWith("override"));
  });
});
