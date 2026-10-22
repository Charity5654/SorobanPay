/**
 * helpArticles.test.ts — unit tests for the help content store.
 * Issue #745.
 */

import {
  helpArticles,
  searchArticles,
  getArticle,
  getArticlesForPage,
  HELP_CONTENT_VERSION,
} from "@/lib/helpArticles";

describe("helpArticles", () => {
  test("all articles have required fields", () => {
    for (const article of helpArticles) {
      expect(article.id).toBeTruthy();
      expect(article.title).toBeTruthy();
      expect(article.summary).toBeTruthy();
      expect(article.content).toBeTruthy();
      expect(article.tags.length).toBeGreaterThan(0);
      expect(article.version).toBeTruthy();
      expect(["home", "subscribe", "dashboard", "settings", "global"]).toContain(
        article.page
      );
    }
  });

  test("article IDs are unique", () => {
    const ids = helpArticles.map((a) => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("HELP_CONTENT_VERSION is set", () => {
    expect(HELP_CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("getArticle", () => {
  test("returns article by id", () => {
    const article = getArticle("connect-freighter");
    expect(article).toBeDefined();
    expect(article!.title).toBe("Connecting Freighter Wallet");
  });

  test("returns undefined for unknown id", () => {
    expect(getArticle("does-not-exist")).toBeUndefined();
  });
});

describe("getArticlesForPage", () => {
  test("returns global articles for any page", () => {
    const articles = getArticlesForPage("subscribe");
    const globalIds = helpArticles.filter((a) => a.page === "global").map((a) => a.id);
    for (const id of globalIds) {
      expect(articles.map((a) => a.id)).toContain(id);
    }
  });

  test("returns page-specific articles", () => {
    const articles = getArticlesForPage("subscribe");
    const subscribeArticles = helpArticles.filter((a) => a.page === "subscribe");
    for (const article of subscribeArticles) {
      expect(articles.map((a) => a.id)).toContain(article.id);
    }
  });

  test("does not return articles from other pages", () => {
    const articles = getArticlesForPage("home");
    const dashboardOnly = helpArticles.filter(
      (a) => a.page === "dashboard"
    );
    for (const article of dashboardOnly) {
      expect(articles.map((a) => a.id)).not.toContain(article.id);
    }
  });
});

describe("searchArticles", () => {
  test("empty query returns all articles", () => {
    expect(searchArticles("").length).toBe(helpArticles.length);
  });

  test("finds articles by title keyword", () => {
    const results = searchArticles("freighter");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("connect-freighter");
  });

  test("finds articles by tag", () => {
    const results = searchArticles("ttl");
    expect(results.some((a) => a.id === "storage-ttl")).toBe(true);
  });

  test("finds articles by content keyword", () => {
    const results = searchArticles("allowance");
    expect(results.length).toBeGreaterThan(0);
  });

  test("returns empty array for no match", () => {
    const results = searchArticles("xxxxxxxxnotexist");
    expect(results.length).toBe(0);
  });

  test("title matches rank higher than content matches", () => {
    // 'freighter' appears in the title of connect-freighter
    const results = searchArticles("freighter");
    expect(results[0].id).toBe("connect-freighter");
  });

  test("search is case-insensitive", () => {
    const lower = searchArticles("freighter");
    const upper = searchArticles("FREIGHTER");
    expect(lower.map((a) => a.id)).toEqual(upper.map((a) => a.id));
  });

  test("trims whitespace from query", () => {
    const results = searchArticles("  freighter  ");
    expect(results.length).toBeGreaterThan(0);
  });
});
