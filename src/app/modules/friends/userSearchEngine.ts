import mongoose from "mongoose";
import { User } from "../user/user.model";
import { USER_ROLES } from "../../../enums/user";

export interface IUserSearchDoc {
  _id: string;
  name: string;
  userName: string;
  email: string;
  profileImage?: string;
  role: string;
  isDeleted?: boolean;
}

export interface ISearchResult {
  total: number;
  users: IUserSearchDoc[];
  source: "cache" | "memory_index" | "db_fallback";
}

class TrieNode {
  children = new Map<string, TrieNode>();
  userIds = new Set<string>();
}

/**
 * Fast in-memory LRU Cache with TTL
 */
class FastLRUCache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 2000, defaultTtlMs = 30_000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deletePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Levenshtein distance algorithm for fuzzy typo matching
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1,     // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

class UserSearchEngineSingleton {
  private users = new Map<string, IUserSearchDoc>();
  private trie = new TrieNode();
  private isInitialized = false;
  private isInitializing = false;
  private lastSyncTime = 0;
  private syncIntervalTimer: NodeJS.Timeout | null = null;

  // Search response cache (Key: `${userId}:${searchTerm}:${page}:${limit}`)
  private searchCache = new FastLRUCache<any>(3000, 30_000);

  // User friendship status cache (Key: `friends:${userId}`)
  private friendshipCache = new FastLRUCache<Map<string, { status: string; requestId: string; isSender: boolean }>>(2000, 45_000);

  // User last focus session cache (Key: `lastSession:${userId}`)
  private lastSessionCache = new FastLRUCache<{ endTime: Date; durationMinutes: number } | null>(5000, 60_000);

  // Active session status cache (Key: `activeSession:${userId}`)
  private activeSessionCache = new FastLRUCache<boolean>(3000, 10_000);

  // Active break status cache (Key: `activeBreak:${userId}`)
  private activeBreakCache = new FastLRUCache<boolean>(3000, 10_000);

  constructor() {
    this.setupPeriodicSync();
  }

  private setupPeriodicSync() {
    // Run sync every 2 minutes in the background
    this.syncIntervalTimer = setInterval(() => {
      this.syncFromDB().catch(() => {});
    }, 2 * 60 * 1000);

    if (this.syncIntervalTimer.unref) {
      this.syncIntervalTimer.unref();
    }
  }

  private insertToken(token: string, userId: string) {
    if (!token) return;
    let curr = this.trie;
    for (const char of token) {
      if (!curr.children.has(char)) {
        curr.children.set(char, new TrieNode());
      }
      curr = curr.children.get(char)!;
      curr.userIds.add(userId);
    }
  }

  /**
   * Initializes the search engine from the database
   */
  public async init(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    await this.syncFromDB();
  }

  /**
   * Syncs active users from DB into in-memory Trie and Map
   */
  public async syncFromDB(): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      const activeUsers = await User.find({
        role: USER_ROLES.USER,
        isDeleted: { $ne: true },
      })
        .select("_id name userName email profileImage role isDeleted")
        .lean();

      const newUsers = new Map<string, IUserSearchDoc>();
      const newTrie = new TrieNode();

      for (const u of activeUsers) {
        const id = u._id.toString();
        const doc: IUserSearchDoc = {
          _id: id,
          name: u.name || "",
          userName: u.userName || u.email?.split("@")[0] || "user",
          email: u.email || "",
          profileImage: u.profileImage || "",
          role: u.role || USER_ROLES.USER,
          isDeleted: u.isDeleted || false,
        };

        newUsers.set(id, doc);

        // Tokens
        const userNameLower = doc.userName.toLowerCase();
        const emailLower = doc.email.toLowerCase();
        const emailPrefix = emailLower.split("@")[0] || "";
        const nameTokens = doc.name.toLowerCase().split(/\s+/).filter(Boolean);

        // Insert into Trie
        this.insertTokenIntoTrie(newTrie, userNameLower, id);
        this.insertTokenIntoTrie(newTrie, emailPrefix, id);
        for (const tok of nameTokens) {
          this.insertTokenIntoTrie(newTrie, tok, id);
        }
      }

      this.users = newUsers;
      this.trie = newTrie;
      this.isInitialized = true;
      this.lastSyncTime = Date.now();
    } catch (err) {
      // Don't crash if DB sync fails
      console.error("[UserSearchEngine] Sync failed:", err);
    } finally {
      this.isInitializing = false;
    }
  }

  private insertTokenIntoTrie(trieRoot: TrieNode, token: string, userId: string) {
    if (!token) return;
    let curr = trieRoot;
    for (const char of token) {
      if (!curr.children.has(char)) {
        curr.children.set(char, new TrieNode());
      }
      curr = curr.children.get(char)!;
      curr.userIds.add(userId);
    }
  }

  /**
   * Upserts a user in the in-memory index in O(1)
   */
  public upsertUser(user: any): void {
    if (!user || !user._id) return;
    const id = user._id.toString();

    if (user.isDeleted || (user.role && user.role !== USER_ROLES.USER)) {
      this.removeUser(id);
      return;
    }

    const doc: IUserSearchDoc = {
      _id: id,
      name: user.name || "",
      userName: user.userName || user.email?.split("@")[0] || "user",
      email: user.email || "",
      profileImage: user.profileImage || "",
      role: user.role || USER_ROLES.USER,
      isDeleted: false,
    };

    this.users.set(id, doc);

    const userNameLower = doc.userName.toLowerCase();
    const emailLower = doc.email.toLowerCase();
    const emailPrefix = emailLower.split("@")[0] || "";
    const nameTokens = doc.name.toLowerCase().split(/\s+/).filter(Boolean);

    this.insertToken(userNameLower, id);
    this.insertToken(emailPrefix, id);
    for (const tok of nameTokens) {
      this.insertToken(tok, id);
    }

    // Invalidate search cache
    this.searchCache.clear();
  }

  /**
   * Removes a user from the in-memory index
   */
  public removeUser(userId: string): void {
    this.users.delete(userId);
    this.searchCache.clear();
  }

  /**
   * Search algorithm with Trie lookup and relevance scoring
   */
  public searchUsers(
    searchTerm: string,
    excludeUserId?: string,
    page: number = 1,
    limit: number = 10,
  ): ISearchResult {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      return { total: 0, users: [], source: "memory_index" };
    }

    // Ensure initial sync has run
    if (!this.isInitialized && this.users.size === 0) {
      return { total: 0, users: [], source: "memory_index" };
    }

    const scoredUsers: { user: IUserSearchDoc; score: number }[] = [];
    const isShortQuery = q.length < 4;

    for (const [id, u] of this.users.entries()) {
      if (excludeUserId && id === excludeUserId) continue;

      const userName = (u.userName || "").toLowerCase();
      const name = (u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const nameWords = name.split(/\s+/);

      let score = 0;

      // 1. Exact matches
      if (userName === q) score += 150;
      else if (name === q) score += 120;

      // 2. Prefix matches (Highest relevance for search as you type)
      if (userName.startsWith(q)) score += 100;
      if (nameWords.some((w) => w.startsWith(q))) score += 85;
      if (email.startsWith(q)) score += 70;

      // 3. Substring matches
      if (userName.includes(q)) score += 50;
      if (name.includes(q)) score += 40;
      if (email.includes(q)) score += 30;

      // 4. Fuzzy matching for longer terms with possible typo (distance <= 1)
      if (!isShortQuery && score === 0) {
        if (Math.abs(userName.length - q.length) <= 1 && levenshteinDistance(userName, q) <= 1) {
          score += 25;
        } else {
          for (const w of nameWords) {
            if (Math.abs(w.length - q.length) <= 1 && levenshteinDistance(w, q) <= 1) {
              score += 20;
              break;
            }
          }
        }
      }

      if (score > 0) {
        scoredUsers.push({ user: u, score });
      }
    }

    // Sort by score desc, then alphabetical by name
    scoredUsers.sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name));

    const total = scoredUsers.length;
    const skip = (page - 1) * limit;
    const paginated = scoredUsers.slice(skip, skip + limit).map((s) => s.user);

    return {
      total,
      users: paginated,
      source: "memory_index",
    };
  }

  // Caching helpers
  public getCachedSearch(key: string): any {
    return this.searchCache.get(key);
  }

  public setCachedSearch(key: string, value: any, ttlMs = 25_000): void {
    this.searchCache.set(key, value, ttlMs);
  }

  public invalidateUserSearchCache(userId: string): void {
    this.searchCache.deletePrefix(`search:${userId}:`);
    this.friendshipCache.delete(`friends:${userId}`);
  }

  public getCachedFriendships(userId: string): Map<string, { status: string; requestId: string; isSender: boolean }> | undefined {
    return this.friendshipCache.get(`friends:${userId}`);
  }

  public setCachedFriendships(userId: string, data: Map<string, { status: string; requestId: string; isSender: boolean }>): void {
    this.friendshipCache.set(`friends:${userId}`, data, 30_000);
  }

  public getCachedLastSession(userId: string): { endTime: Date; durationMinutes: number } | null | undefined {
    return this.lastSessionCache.get(`lastSession:${userId}`);
  }

  public setCachedLastSession(userId: string, session: { endTime: Date; durationMinutes: number } | null): void {
    this.lastSessionCache.set(`lastSession:${userId}`, session, 60_000);
  }

  public getCachedActiveSession(userId: string): boolean | undefined {
    return this.activeSessionCache.get(`activeSession:${userId}`);
  }

  public setCachedActiveSession(userId: string, isActive: boolean): void {
    this.activeSessionCache.set(`activeSession:${userId}`, isActive, 10_000);
  }

  public getCachedActiveBreak(userId: string): boolean | undefined {
    return this.activeBreakCache.get(`activeBreak:${userId}`);
  }

  public setCachedActiveBreak(userId: string, isBreak: boolean): void {
    this.activeBreakCache.set(`activeBreak:${userId}`, isBreak, 10_000);
  }

  public isReady(): boolean {
    return this.isInitialized && this.users.size > 0;
  }
}

export const UserSearchEngine = new UserSearchEngineSingleton();
