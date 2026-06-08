/*
This file renders the editable calendar name and compact month range controls.
Edit this file when calendar naming, range presets, or date range controls change.
Copy this file when another calendar page needs the same title controls.
*/

import React from "react"
import { useCalendar } from "../contexts/CalendarContext"
import { isAfter, MonthPointer, MonthRange } from "../utils/monthRange"

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const SHORT_MONTH_NAMES = MONTH_NAMES.map((monthName) => monthName.slice(0, 3))

interface RangePreset {
  id: string
  label: string
  range: MonthRange
}

const toMonthInputValue = (pointer: MonthPointer): string => {
  return `${pointer.year}-${String(pointer.month + 1).padStart(2, "0")}`
}

const parseMonthInputValue = (value: string): MonthPointer => {
  const [yearValue, monthValue] = value.split("-")
  const year = Number.parseInt(yearValue, 10)
  const month = Number.parseInt(monthValue, 10) - 1
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error(`Invalid month value: ${value}`)
  }
  return { year, month }
}

const formatMonth = (pointer: MonthPointer): string => {
  return `${SHORT_MONTH_NAMES[pointer.month]} ${pointer.year}`
}

const formatRange = (range: MonthRange): string => {
  return `${formatMonth(range.start)} to ${formatMonth(range.end)}`
}

const rangesEqual = (left: MonthRange, right: MonthRange): boolean => {
  return (
    left.start.year === right.start.year &&
    left.start.month === right.start.month &&
    left.end.year === right.end.year &&
    left.end.month === right.end.month
  )
}

const buildRangePresets = (currentYear: number): RangePreset[] => [
  {
    id: "this-year",
    label: "This year",
    range: {
      start: { year: currentYear, month: 0 },
      end: { year: currentYear, month: 11 },
    },
  },
  {
    id: "school-year",
    label: "School year",
    range: {
      start: { year: currentYear - 1, month: 8 },
      end: { year: currentYear, month: 7 },
    },
  },
  {
    id: "last-and-this",
    label: "Last + this",
    range: {
      start: { year: currentYear - 1, month: 0 },
      end: { year: currentYear, month: 11 },
    },
  },
  {
    id: "this-and-next",
    label: "This + next",
    range: {
      start: { year: currentYear, month: 0 },
      end: { year: currentYear + 1, month: 11 },
    },
  },
]

const CalendarTitle: React.FC = () => {
  const { name, setName, monthRange, setMonthRange, canEdit } = useCalendar()
  const currentYear = new Date().getFullYear()
  const presets = buildRangePresets(currentYear)
  const minMonth = `${currentYear - 5}-01`
  const maxMonth = `${currentYear + 10}-12`

  const handleStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) return
    const newStart = parseMonthInputValue(event.target.value)
    const newEnd = isAfter(newStart, monthRange.end) ? { ...newStart } : monthRange.end
    setMonthRange({ start: newStart, end: newEnd })
  }

  const handleEndChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) return
    const newEnd = parseMonthInputValue(event.target.value)
    const newStart = isAfter(monthRange.start, newEnd) ? { ...newEnd } : monthRange.start
    setMonthRange({ start: newStart, end: newEnd })
  }

  return (
    <header style={{ textAlign: "center", marginBottom: "30px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: "32px", lineHeight: 1.2 }}>
        {canEdit ? (
          <input
            aria-label="Calendar name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={{
              display: "inline-block",
              width: "min(90vw, 520px)",
              border: "none",
              background: "transparent",
              color: "inherit",
              font: "inherit",
              fontWeight: "inherit",
              textAlign: "center",
              outline: "none",
            }}
          />
        ) : (
          <span>{name}</span>
        )}
      </h1>

      <p style={{ margin: "0 0 14px", color: "#475569", fontSize: "15px", fontWeight: 600 }}>
        {formatRange(monthRange)}
      </p>

      {canEdit ? (
        <div
          className="no-print"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            aria-label="Calendar range presets"
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "8px",
              maxWidth: "860px",
            }}
          >
            {presets.map((preset) => {
              const isActive = rangesEqual(monthRange, preset.range)
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setMonthRange(preset.range)}
                  title={formatRange(preset.range)}
                  style={{
                    minHeight: "36px",
                    padding: "8px 12px",
                    border: isActive ? "2px solid #111827" : "1px solid #cbd5e1",
                    borderRadius: "6px",
                    background: isActive ? "#111827" : "#f8fafc",
                    color: isActive ? "#ffffff" : "#0f172a",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "10px",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#475569", fontSize: "14px" }}>
              <span>Start</span>
              <input
                type="month"
                value={toMonthInputValue(monthRange.start)}
                min={minMonth}
                max={maxMonth}
                onChange={handleStartChange}
                style={{
                  minHeight: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  background: "#ffffff",
                  color: "#0f172a",
                  padding: "6px 8px",
                  fontSize: "14px",
                }}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#475569", fontSize: "14px" }}>
              <span>End</span>
              <input
                type="month"
                value={toMonthInputValue(monthRange.end)}
                min={minMonth}
                max={maxMonth}
                onChange={handleEndChange}
                style={{
                  minHeight: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  background: "#ffffff",
                  color: "#0f172a",
                  padding: "6px 8px",
                  fontSize: "14px",
                }}
              />
            </label>
          </div>
        </div>
      ) : null}
    </header>
  )
}

export default CalendarTitle
