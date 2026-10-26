import mongoose from "mongoose";
import { Mode } from "../modes/modes.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break, BreakConfig } from "./breaks.model";
import {
  DEFAULT_TIMEZONE,
  getZonedEndOfDay,
  getZonedStartOfDay,
} from "../../../helpers/timezoneHelper";
import { IBreakConfig } from "./breaks.interface";

export interface IBreakState {
  activeMode: { _id: any } | null;
  activeSession: {
    _id: any;
    modeId?: any;
    maxBreaks?: number;
    breakDurationMinutes?: number;
    usedBreaksCount?: number;
  } | null;
  existingBreak: any | null;
  breakConfig: {
    breaksPerDay: number;
    breakDurationMinutes: number;
  };
  breaksToday: number;
  dateKey: string;
  lastFetchedAt: number;
}

const breakStateCache = new Map<string, IBreakState>();

export const BreakCache = {
  /**
   * Retrieves user break state from in-memory cache if fresh, or loads from DB in parallel.
   */
  async getOrFetchState(
    userId: string,
    userTimezone: string = DEFAULT_TIMEZONE,
    forceRefresh = false,
  ): Promise<IBreakState> {
    const cached = breakStateCache.get(userId);
    const now = Date.now();
    const nowDate = new Date();
    const currentDateKey = getZonedStartOfDay(nowDate, userTimezone).toISOString();

    // Cache is valid for 30 seconds AND must be from the same day
    if (
      !forceRefresh &&
      cached &&
      now - cached.lastFetchedAt < 30_000 &&
      cached.dateKey === currentDateKey
    ) {
      return cached;
    }
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const startOfDay = getZonedStartOfDay(nowDate, userTimezone);
    const endOfDay = getZonedEndOfDay(nowDate, userTimezone);

    // Highly optimized parallel queries with field selection and lean
    const [
      activeMode,
      activeSession,
      existingBreak,
      breakConfigDoc,
      breaksToday,
    ] = await Promise.all([
      Mode.findOne({
        userId: userObjectId,
        isActive: true,
        isDeleted: false,
      })
        .select("_id")
        .lean(),

      FocusSession.findOne({
        userId: userObjectId,
        status: "active",
        isDeleted: false,
      })
        .select("_id modeId maxBreaks breakDurationMinutes usedBreaksCount")
        .lean(),

      Break.findOne({
        userId: userObjectId,
        nudgeId: { $exists: false },
        status: "active",
        endTime: { $gt: nowDate },
        isDeleted: false,
      })
        .select(
          "_id startTime createdAt endTime totalDurationMinutes remainingSeconds durationMinutes modeId status isDeleted updatedAt",
        )
        .lean(),

      BreakConfig.findOne({
        userId: userObjectId,
        isDeleted: false,
      })
        .select("breaksPerDay breakDurationMinutes")
        .lean(),

      Break.countDocuments({
        userId: userObjectId,
        nudgeId: { $exists: false },
        createdAt: { $gte: startOfDay, $lte: endOfDay },
        isDeleted: false,
      }),
    ]);

    const effectiveConfig = breakConfigDoc || {
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    };

    if (!breakConfigDoc) {
      BreakConfig.create({
        userId: userObjectId,
        breaksPerDay: 4,
        breakDurationMinutes: 15,
      }).catch(() => {});
    }

    const state: IBreakState = {
      activeMode,
      activeSession,
      existingBreak,
      breakConfig: {
        breaksPerDay: effectiveConfig.breaksPerDay ?? 4,
        breakDurationMinutes: effectiveConfig.breakDurationMinutes ?? 15,
      },
      breaksToday,
      dateKey: currentDateKey,
      lastFetchedAt: Date.now(),
    };

    breakStateCache.set(userId, state);
    return state;
  },

  /**
   * Sets newly started active break in memory.
   */
  setActiveBreak(
    userId: string,
    breakDoc: any,
    durationMinutes: number,
    userTimezone: string = DEFAULT_TIMEZONE,
  ) {
    const cached = breakStateCache.get(userId);
    if (cached) {
      cached.existingBreak = breakDoc;
      cached.breaksToday = (cached.breaksToday || 0) + 1;
      if (cached.activeSession) {
        cached.activeSession.usedBreaksCount =
          (cached.activeSession.usedBreaksCount || 0) + 1;
      }
      cached.lastFetchedAt = Date.now();
    } else {
      const now = new Date();
      breakStateCache.set(userId, {
        activeMode: breakDoc.modeId ? { _id: breakDoc.modeId } : null,
        activeSession: null,
        existingBreak: breakDoc,
        breakConfig: { breaksPerDay: 4, breakDurationMinutes: durationMinutes },
        breaksToday: 1,
        dateKey: getZonedStartOfDay(now, userTimezone).toISOString(),
        lastFetchedAt: Date.now(),
      });
    }
  },

  /**
   * Retrieves active break from cache if present and active.
   */
  getActiveBreak(userId: string) {
    const cached = breakStateCache.get(userId);
    if (!cached || !cached.existingBreak) return null;

    const now = new Date();
    const breakEndTime = cached.existingBreak.endTime
      ? new Date(cached.existingBreak.endTime)
      : null;

    if (
      cached.existingBreak.status === "active" &&
      breakEndTime &&
      breakEndTime.getTime() > now.getTime()
    ) {
      return cached.existingBreak;
    }

    return null;
  },

  /**
   * Clears active break from cache.
   */
  clearActiveBreak(userId: string) {
    const cached = breakStateCache.get(userId);
    if (cached) {
      cached.existingBreak = null;
      cached.lastFetchedAt = Date.now();
    }
  },

  /**
   * Updates cached break config.
   */
  updateBreakConfig(userId: string, config: Partial<IBreakConfig>) {
    const cached = breakStateCache.get(userId);
    if (cached) {
      if (typeof config.breaksPerDay === "number") {
        cached.breakConfig.breaksPerDay = config.breaksPerDay;
      }
      if (typeof config.breakDurationMinutes === "number") {
        cached.breakConfig.breakDurationMinutes = config.breakDurationMinutes;
      }
      cached.lastFetchedAt = Date.now();
    }
  },

  /**
   * Invalidates cache for a user.
   */
  invalidate(userId: string) {
    breakStateCache.delete(userId);
  },
};
