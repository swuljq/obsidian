const assert = require("node:assert/strict");
const {
    getCountdownStatus,
    localDateOrdinal,
    parseDate,
    parseMarker,
} = require("./countdown-core");

assert.equal(parseDate("2025-02-29"), null);
assert.equal(parseDate("2024-02-29").day, 29);
assert.equal(parseMarker("ordinary inline code"), null);
assert.equal(parseMarker("countdown:2026-09-24~2026-09-19"), null);

const marker = parseMarker("countdown:2026-09-19~2026-09-24");
assert.equal(marker.start.value, "2026-09-19");
assert.equal(marker.end.value, "2026-09-24");

assert.deepEqual(
    getCountdownStatus(marker.end, new Date(2026, 8, 19, 23, 59), false),
    { type: "remaining", label: "还剩 6 天" }
);
assert.deepEqual(
    getCountdownStatus(marker.end, new Date(2026, 8, 24, 12), false),
    { type: "due-today", label: "今天截止" }
);
assert.deepEqual(
    getCountdownStatus(marker.end, new Date(2026, 8, 26, 1), false),
    { type: "overdue", label: "已逾期 2 天" }
);
assert.deepEqual(
    getCountdownStatus(marker.end, new Date(2026, 8, 19), true),
    { type: "completed", label: "已完成" }
);

assert.equal(
    localDateOrdinal(new Date(2027, 0, 1)) - localDateOrdinal(new Date(2026, 11, 31)),
    1
);

console.log("schedule-countdown core tests passed");
