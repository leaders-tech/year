/*
This file renders the main year planner controls and active calendar view.
Edit this file when the calendar page layout or visible controls change.
Copy this file only when adding another full calendar-style workspace.
*/

import React from "react"
import { useCalendar } from "../contexts/CalendarContext"
import CalendarTitle from "./CalendarTitle"
import CalendarSharingControls from "./CalendarSharingControls"
import ColorPicker from "./ColorPicker"
import SaveLoadData from "./SaveLoadData"
import ClassicView from "./views/ClassicView"
import ColumnView from "./views/ColumnView"
import LinearView from "./views/LinearView"
import ViewSelector from "./ViewSelector"

const Calendar: React.FC = () => {
  const {
    monthRange,
    dateCells,
    setDateCells,
    selectedColorTexture,
    selectedView,
    setSelectedView,
    canEdit,
    loading,
    error,
  } = useCalendar()

  if (loading) {
    return <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>Loading calendar...</div>
  }

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <CalendarTitle />
      <div className="no-print">
        <CalendarSharingControls />
        {canEdit ? <ColorPicker /> : null}
        <ViewSelector selectedView={selectedView} onViewChange={setSelectedView} />
        {error ? (
          <div
            style={{
              color: "#b91c1c",
              fontSize: "13px",
              marginBottom: "16px",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      {selectedView === "Linear" ? (
        <LinearView
          monthRange={monthRange}
          dateCells={dateCells}
          setDateCells={setDateCells}
          selectedColorTexture={selectedColorTexture}
          canEdit={canEdit}
        />
      ) : selectedView === "Classic" ? (
        <ClassicView
          monthRange={monthRange}
          dateCells={dateCells}
          setDateCells={setDateCells}
          selectedColorTexture={selectedColorTexture}
          canEdit={canEdit}
        />
      ) : (
        <ColumnView
          monthRange={monthRange}
          dateCells={dateCells}
          setDateCells={setDateCells}
          selectedColorTexture={selectedColorTexture}
          canEdit={canEdit}
        />
      )}

      <div className="no-print">
        <SaveLoadData />
      </div>
    </div>
  )
}

export default Calendar
