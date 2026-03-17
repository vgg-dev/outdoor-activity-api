const ACTIVITY_RULES = {
  hike: {
    daylightPreference: "day",
    preferredMinTemp: 50,
    preferredMaxTemp: 80,
    maxWind: 25,
    maxRainChance: 40,
    daylightHourPenalty: 16,
    daylightWindowBonus: 8,
    highUvPenaltyThreshold: 8,
    highUvPenalty: 10,
    recencyPenaltyPerHour: 0.35,
    sameDayWindowBonus: 3,
    sameDayMinimumScore: 80,
    minWindowHours: 1,
    targetWindowHours: 3,
    maxWindowHours: 4,
  },
  bike: {
    daylightPreference: "day",
    preferredMinTemp: 45,
    preferredMaxTemp: 85,
    maxWind: 20,
    maxRainChance: 30,
    daylightHourPenalty: 16,
    daylightWindowBonus: 8,
    highUvPenaltyThreshold: 8,
    highUvPenalty: 10,
    recencyPenaltyPerHour: 0.45,
    sameDayWindowBonus: 4,
    sameDayMinimumScore: 80,
    minWindowHours: 1,
    targetWindowHours: 2,
    maxWindowHours: 3,
  },
  fishing: {
    daylightPreference: "day",
    preferredMinTemp: 45,
    preferredMaxTemp: 82,
    maxWind: 18,
    maxRainChance: 35,
    daylightHourPenalty: 10,
    daylightWindowBonus: 6,
    highUvPenaltyThreshold: 9,
    highUvPenalty: 6,
    recencyPenaltyPerHour: 0.3,
    sameDayWindowBonus: 4,
    sameDayMinimumScore: 78,
    minWindowHours: 2,
    targetWindowHours: 3,
    maxWindowHours: 4,
  },
  astronomy: {
    daylightPreference: "night",
    preferredMinTemp: 35,
    preferredMaxTemp: 72,
    maxWind: 12,
    maxRainChance: 10,
    daylightHourPenalty: 26,
    daylightWindowBonus: 12,
    highUvPenaltyThreshold: 99,
    highUvPenalty: 0,
    recencyPenaltyPerHour: 0.15,
    sameDayWindowBonus: 6,
    sameDayMinimumScore: 75,
    minWindowHours: 1,
    targetWindowHours: 2,
    maxWindowHours: 4,
  },
  drone: {
    daylightPreference: "day",
    preferredMinTemp: 40,
    preferredMaxTemp: 90,
    maxWind: 12,
    maxRainChance: 10,
    daylightHourPenalty: 20,
    daylightWindowBonus: 10,
    highUvPenaltyThreshold: 10,
    highUvPenalty: 4,
    recencyPenaltyPerHour: 0.7,
    sameDayWindowBonus: 6,
    sameDayMinimumScore: 85,
    minWindowHours: 1,
    targetWindowHours: 1,
    maxWindowHours: 2,
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function skyPenalty(shortForecast) {
  const text = String(shortForecast || "").toLowerCase();

  if (
    text.includes("rain") ||
    text.includes("snow") ||
    text.includes("thunder") ||
    text.includes("showers")
  ) {
    return 35;
  }

  if (
    text.includes("fog") ||
    text.includes("haze") ||
    text.includes("smoke") ||
    text.includes("overcast")
  ) {
    return 28;
  }

  if (text.includes("mostly cloudy") || text.includes("cloudy")) {
    return 22;
  }

  if (text.includes("partly cloudy") || text.includes("mostly clear")) {
    return 10;
  }

  return 0;
}

function scoreHour(hour, activity, context = {}) {
  const rules = ACTIVITY_RULES[activity] || ACTIVITY_RULES.hike;
  const reasons = [];
  let score = 100;

  if (typeof hour.temperatureF === "number") {
    if (hour.temperatureF < rules.preferredMinTemp) {
      score -= clamp((rules.preferredMinTemp - hour.temperatureF) * 2, 0, 30);
      reasons.push("Cooler than preferred");
    } else if (hour.temperatureF > rules.preferredMaxTemp) {
      score -= clamp((hour.temperatureF - rules.preferredMaxTemp) * 2, 0, 35);
      reasons.push("Warmer than preferred");
    }
  }

  if (typeof hour.windSpeedMph === "number") {
    if (hour.windSpeedMph > rules.maxWind) {
      score -= clamp((hour.windSpeedMph - rules.maxWind) * 3, 0, 40);
      reasons.push("Windier than preferred");
    } else {
      reasons.push("Wind conditions look good");
    }
  }

  if (typeof hour.precipitationChance === "number") {
    if (hour.precipitationChance > rules.maxRainChance) {
      score -= clamp((hour.precipitationChance - rules.maxRainChance), 0, 35);
      reasons.push("Higher rain chance");
    } else {
      reasons.push("Low rain chance");
    }
  }

  if (typeof hour.aqi === "number") {
    if (hour.aqi > 150) {
      score -= 45;
      reasons.push("Unhealthy air quality");
    } else if (hour.aqi > 100) {
      score -= 25;
      reasons.push("Air quality may affect sensitive groups");
    } else if (hour.aqi > 50) {
      score -= 10;
      reasons.push("Moderate air quality");
    } else {
      reasons.push("Air quality is good");
    }
  }

  if (
    typeof hour.uvIndex === "number" &&
    hour.isDaytime &&
    hour.uvIndex >= (rules.highUvPenaltyThreshold || 99)
  ) {
    score -= rules.highUvPenalty || 0;
    reasons.push("High UV exposure");
  }

  if (rules.daylightPreference === "night") {
    if (hour.isDaytime) {
      score -= rules.daylightHourPenalty || 0;
      reasons.push("Dark skies are preferred");
    } else {
      reasons.push("Nighttime is preferred");
    }
  } else if (!hour.isDaytime) {
    score -= rules.daylightHourPenalty || 0;
    reasons.push("Nighttime is less preferred");
  } else {
    reasons.push("Daylight is preferred");
  }

  if (activity === "astronomy") {
    const penalty = skyPenalty(hour.shortForecast);
    if (penalty > 0) {
      score -= penalty;
      reasons.push("Clear skies are important");
    } else {
      reasons.push("Skies look clear");
    }
  }

  const hasHighRiskAlert = Boolean(context.hasHighRiskAlert);

  const isHardStop =
    hasHighRiskAlert ||
    (typeof hour.aqi === "number" && hour.aqi > 180) ||
    (activity === "drone" && hour.windSpeedMph > 20);

  if (isHardStop) {
    score = Math.min(score, 20);
    reasons.push("Safety override applied");
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    isHardStop,
    reasons: Array.from(new Set(reasons)).slice(0, 3),
  };
}

function summarizeWindow(window) {
  const avgScore =
    window.hours.reduce((sum, h) => sum + h.score, 0) / window.hours.length;
  const summaryReasons = Array.from(
    new Set(window.hours.flatMap((h) => h.reasons))
  ).slice(0, 3);

  return {
    start: window.start,
    end: window.end,
    hours: window.hours.length,
    averageScore: Math.round(avgScore),
    why: summaryReasons,
  };
}

function windowsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function isFullyDaytime(window) {
  return window.hours.every((hour) => hour.isDaytime);
}

function isFullyNighttime(window) {
  return window.hours.every((hour) => !hour.isDaytime);
}

function getAverageScore(window) {
  return window.hours.reduce((sum, hour) => sum + hour.score, 0) / window.hours.length;
}

function isSameLocalDay(referenceDate, targetIso) {
  const targetDate = new Date(targetIso);
  return (
    referenceDate.getFullYear() === targetDate.getFullYear() &&
    referenceDate.getMonth() === targetDate.getMonth() &&
    referenceDate.getDate() === targetDate.getDate()
  );
}

function buildCandidateWindows(segment, rules, now) {
  const candidates = [];
  const minWindowHours = rules.minWindowHours || 1;
  const maxWindowHours = rules.maxWindowHours || 3;
  const targetWindowHours = rules.targetWindowHours || maxWindowHours;

  for (let startIndex = 0; startIndex < segment.length; startIndex += 1) {
    for (
      let length = minWindowHours;
      length <= maxWindowHours && startIndex + length <= segment.length;
      length += 1
    ) {
      const hours = segment.slice(startIndex, startIndex + length);
      const avgScore =
        hours.reduce((sum, hour) => sum + hour.score, 0) / hours.length;
      const closenessPenalty = Math.abs(length - targetWindowHours) * 3;
      const daylightRatio =
        hours.filter((hour) => hour.isDaytime).length / hours.length;
      const daylightBonus = daylightRatio * (rules.daylightWindowBonus || 0);
      const startMs = Date.parse(hours[0].startTime);
      const hoursUntilStart = Math.max(0, (startMs - now.getTime()) / (60 * 60 * 1000));
      const recencyPenalty =
        hoursUntilStart * (rules.recencyPenaltyPerHour || 0);
      const sameDayBonus = isSameLocalDay(now, hours[0].startTime)
        ? rules.sameDayWindowBonus || 0
        : 0;

      candidates.push({
        start: hours[0].startTime,
        end: hours[hours.length - 1].endTime,
        hours,
        rankingScore:
          avgScore -
          closenessPenalty +
          daylightBonus +
          sameDayBonus -
          recencyPenalty,
      });
    }
  }

  return candidates;
}

function topWindows(scoredHours, activity, minScore = 60, maxWindows = 3) {
  const rules = ACTIVITY_RULES[activity] || ACTIVITY_RULES.hike;
  const now = new Date();
  const segments = [];
  let current = null;

  for (const hour of scoredHours) {
    const eligible = hour.score >= minScore && !hour.isHardStop;

    if (eligible) {
      if (!current) {
        current = {
          hours: [hour],
        };
      } else {
        current.hours.push(hour);
      }
    } else if (current) {
      segments.push(current.hours);
      current = null;
    }
  }

  if (current) {
    segments.push(current.hours);
  }

  const rankedCandidates = segments
    .flatMap((segment) => buildCandidateWindows(segment, rules, now))
    .sort((a, b) => {
      const scoreDiff = b.rankingScore - a.rankingScore;
      if (scoreDiff !== 0) return scoreDiff;

      const avgDiff =
        summarizeWindow(b).averageScore - summarizeWindow(a).averageScore;
      if (avgDiff !== 0) return avgDiff;

      return a.hours.length - b.hours.length;
    });

  let daylightPool = rankedCandidates;
  if (rules.daylightPreference === "night") {
    const nighttimeCandidates = rankedCandidates.filter(isFullyNighttime);
    daylightPool =
      nighttimeCandidates.length > 0 ? nighttimeCandidates : rankedCandidates;
  } else {
    const daytimeCandidates = rankedCandidates.filter(isFullyDaytime);
    daylightPool =
      daytimeCandidates.length > 0 ? daytimeCandidates : rankedCandidates;
  }
  const sameDayCandidates = daylightPool.filter((candidate) =>
    isSameLocalDay(now, candidate.start)
  );
  const strongSameDayCandidates = sameDayCandidates.filter(
    (candidate) => getAverageScore(candidate) >= (rules.sameDayMinimumScore || 80)
  );
  const fallbackCandidates =
    strongSameDayCandidates.length > 0 ? strongSameDayCandidates : daylightPool;

  const selected = [];
  for (const candidate of fallbackCandidates) {
    if (selected.length >= maxWindows) break;
    if (selected.some((picked) => windowsOverlap(candidate, picked))) {
      continue;
    }
    selected.push(summarizeWindow(candidate));
  }

  return selected;
}

function isSupportedActivity(activity) {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_RULES, activity);
}

module.exports = {
  scoreHour,
  topWindows,
  isSupportedActivity,
  ACTIVITY_RULES,
};
