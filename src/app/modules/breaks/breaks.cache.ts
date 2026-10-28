import mongoose from "mongoose";
import { Mode } from "../modes/modes.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break, BreakConfig } from "./breaks.model";
import {
  DEFAULT_TIMEZONE,
  getZonedEndOfDay,
  getZonedStartOfDay,
  dayjs,
} from "../../../helpers/timezoneHelper";
import { IBreakConfig } from "./breaks.interface";

export interface IBreakState {
  activeMode: { _id: any; [key: string]: any } | null;
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
  todayCompletedMinutes: number;
  weekCompletedMinutes: number;
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
    const currentDateKey = getZonedStartOfDay(
      nowDate,
      userTimezone,
    ).toISOString();

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
    const startOfWeek = dayjs()
      .tz(userTimezone)
      .subtract(6, "day")
      .startOf("day")
      .toDate();

    // Highly optimized parallel queries with field selection and lean
    const [
      activeMode,
      activeSession,
      breakConfigDoc,
      recentBreaks,
    ] = await Promise.all([
      Mode.findOne({
        userId: userObjectId,
        isActive: true,
        isDeleted: false,
      })
        .select("_id name icon totalLockedApps")
        .lean(),

      FocusSession.findOne({
        userId: userObjectId,
        status: "active",
        isDeleted: false,
      })
        .select("_id modeId maxBreaks breakDurationMinutes usedBreaksCount")
        .lean(),

      BreakConfig.findOne({
        userId: userObjectId,
        isDeleted: false,
      })
        .select("breaksPerDay breakDurationMinutes")
        .lean(),

      Break.find({
        userId: userObjectId,
        $or: [
          { createdAt: { $gte: startOfWeek } },
          { status: "active" },
        ],
        isDeleted: false,
      })
        .select(
          "_id userId modeId nudgeId clientBreakId startTime endTime durationMinutes totalDurationMinutes remainingSeconds status isDeleted createdAt updatedAt",
        )
        .populate("modeId")
        .lean(),
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

    let existingBreak: any = null;
    let breaksToday = 0;
    let todayCompletedMinutes = 0;
    let weekCompletedMinutes = 0;

    const startOfDayMs = startOfDay.getTime();
    const endOfDayMs = endOfDay.getTime();
    const startOfWeekMs = startOfWeek.getTime();
    const nowMs = nowDate.getTime();

    for (const b of recentBreaks) {
      const bCreatedAtMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const bEndTimeMs = b.endTime ? new Date(b.endTime).getTime() : 0;

      // Active break check
      if (!b.nudgeId && b.status === "active" && bEndTimeMs > nowMs) {
        if (
          !existingBreak ||
          bEndTimeMs > new Date(existingBreak.endTime).getTime()
        ) {
          existingBreak = b;
        }
      }

      // Count of breaks started today (excluding nudges)
      if (
        !b.nudgeId &&
        bCreatedAtMs >= startOfDayMs &&
        bCreatedAtMs <= endOfDayMs
      ) {
        breaksToday++;
      }

      // Completed minutes
      if (b.status === "completed") {
        const mins = b.durationMinutes || 0;
        if (bCreatedAtMs >= startOfDayMs && bCreatedAtMs <= endOfDayMs) {
          todayCompletedMinutes += mins;
        }
        if (bCreatedAtMs >= startOfWeekMs) {
          weekCompletedMinutes += mins;
        }
      }
    }

    // Preserve any in-memory active break if present
    const inMemoryActive = BreakCache.getActiveBreak(userId);
    if (inMemoryActive) {
      existingBreak = inMemoryActive;
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
      todayCompletedMinutes,
      weekCompletedMinutes,
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
        todayCompletedMinutes: 0,
        weekCompletedMinutes: 0,
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
  clearActiveBreak(userId: string, durationMinutes?: number) {
    const cached = breakStateCache.get(userId);
    if (cached) {
      cached.existingBreak = null;
      if (typeof durationMinutes === "number" && durationMinutes > 0) {
        cached.todayCompletedMinutes =
          (cached.todayCompletedMinutes || 0) + durationMinutes;
        cached.weekCompletedMinutes =
          (cached.weekCompletedMinutes || 0) + durationMinutes;
      }
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
