/*
This file renders JSON export, import, and clear controls for a calendar.
Edit this file when calendar backup or restore behavior changes.
Copy this file when another feature needs simple JSON import/export controls.
*/

import React, { useRef } from "react"
import { useCalendar } from "../contexts/CalendarContext"
import type { CalendarSnapshot } from "../types"
import { UI_COLORS } from "../utils/colors"
import { createDefaultMonthRange } from "../utils/monthRange"

const SaveLoadData: React.FC = () => {
  const {
    canEdit,
    getCurrentDataSnapshot,
    replaceCalendar,
  } = useCalendar()

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSaveData = () => {
    const snapshot = getCurrentDataSnapshot()
    const dataToSave = {
      ...snapshot,
      exportDate: new Date().toISOString(),
      version: "4.0",
    }

    const blob = new Blob([JSON.stringify(dataToSave, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `year-planner-data-${new Date().toISOString().split("T")[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleLoadData = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const loadedData = JSON.parse(e.target?.result as string)

        if (!loadedData || typeof loadedData !== "object") {
          alert("Invalid data file format")
          return
        }

        const importedSnapshot: CalendarSnapshot = {
          name: typeof loadedData.name === "string" ? loadedData.name : "My year",
          monthRange:
            loadedData.monthRange && loadedData.monthRange.start && loadedData.monthRange.end
              ? loadedData.monthRange
              : loadedData.selectedYear && typeof loadedData.selectedYear === "number"
                ? createDefaultMonthRange(loadedData.selectedYear)
                : createDefaultMonthRange(new Date().getFullYear()),
          dateCells: loadedData.dateCells && typeof loadedData.dateCells === "object" ? loadedData.dateCells : {},
          selectedColorTexture:
            loadedData.selectedColorTexture && typeof loadedData.selectedColorTexture === "string"
              ? loadedData.selectedColorTexture
              : "red",
          selectedView:
            loadedData.selectedView && ["Linear", "Classic", "Column"].includes(loadedData.selectedView)
              ? loadedData.selectedView
              : "Linear",
          version: "4.0",
        }
        replaceCalendar(importedSnapshot)
      } catch (error) {
        alert("Error loading data: Invalid JSON format")
        console.error("Error parsing loaded data:", error)
      }
    }
    reader.readAsText(file)

    event.target.value = ""
  }

  const handleCleanAll = () => {
    if (window.confirm("Are you sure you want to delete all data? This action cannot be undone.")) {
      replaceCalendar({
        name: "My year",
        monthRange: createDefaultMonthRange(new Date().getFullYear()),
        dateCells: {},
        selectedColorTexture: "red",
        selectedView: "Linear",
        version: "4.0",
      })
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "16px",
          marginTop: "30px",
          padding: "20px",
          borderTop: `1px solid ${UI_COLORS.border.tertiary}`,
        }}
      >
        <button
          onClick={handleSaveData}
          style={{
            padding: "12px 20px",
            fontSize: "14px",
            fontWeight: "bold",
            backgroundColor: UI_COLORS.button.primary.normal,
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            transition: "background-color 0.2s ease",
            touchAction: "auto",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = UI_COLORS.button.primary.hover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = UI_COLORS.button.primary.normal
          }}
        >
          Save Data...
        </button>

        {canEdit ? (
          <>
            <button
              onClick={handleLoadData}
              style={{
                padding: "12px 20px",
                fontSize: "14px",
                fontWeight: "bold",
                backgroundColor: UI_COLORS.button.success.normal,
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "background-color 0.2s ease",
                touchAction: "auto",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.button.success.hover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.button.success.normal
              }}
            >
              Load Data
            </button>

            <button
              onClick={handleCleanAll}
              style={{
                padding: "12px 20px",
                fontSize: "14px",
                fontWeight: "bold",
                backgroundColor: UI_COLORS.button.danger.normal,
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "background-color 0.2s ease",
                touchAction: "auto",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.button.danger.hover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.button.danger.normal
              }}
            >
              Clean All
            </button>
          </>
        ) : null}

        <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: "none" }} />
      </div>

      <div
        style={{
          color: UI_COLORS.text.secondary,
          textAlign: "center",
          maxWidth: "800px",
          margin: "0 auto",
          padding: "20px",
        }}
      >
        <p style={{ fontSize: "16px" }}>
          Calendar changes are saved on the server.
        </p>
        <p style={{ fontSize: "13px", paddingTop: "20px" }}>
          Anyone with the view link can see this calendar. Anyone with the edit link can change it.
        </p>
        <p style={{ fontSize: "13px", paddingBottom: "100px" }}>
          Use this for sharing plans, not for secrets.
        </p>
      </div>
    </>
  )
}

export default SaveLoadData
