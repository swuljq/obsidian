const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const milliseconds = Date.UTC(year, month - 1, day);
    const date = new Date(milliseconds);

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return {
        value,
        year,
        month,
        day,
        ordinal: Math.floor(milliseconds / MS_PER_DAY),
    };
}

function parseMarker(value) {
    const match = /^countdown\s*:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/i.exec(
        (value || "").trim()
    );
    if (!match) return null;

    const start = parseDate(match[1]);
    const end = parseDate(match[2]);
    if (!start || !end || end.ordinal < start.ordinal) return null;

    return { start, end };
}

function localDateOrdinal(now) {
    return Math.floor(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY
    );
}

function getCountdownStatus(endDate, now = new Date(), completed = false) {
    if (completed) {
        return { type: "completed", label: "已完成" };
    }

    const daysUntilEnd = endDate.ordinal - localDateOrdinal(now);

    if (daysUntilEnd === 0) {
        return { type: "due-today", label: "今天截止" };
    }
    if (daysUntilEnd < 0) {
        return { type: "overdue", label: `已逾期 ${Math.abs(daysUntilEnd)} 天` };
    }

    return { type: "remaining", label: `还剩 ${daysUntilEnd + 1} 天` };
}

module.exports = {
    getCountdownStatus,
    localDateOrdinal,
    parseDate,
    parseMarker,
};
