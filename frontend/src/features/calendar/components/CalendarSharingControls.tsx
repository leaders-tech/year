/*
This file renders copy buttons for view and edit calendar links.
Edit this file when calendar sharing links or copy behavior changes.
Copy this file when another feature needs simple link-sharing controls.
*/

import React, { useState } from "react"
import { useCalendar } from "../contexts/CalendarContext"
import { UI_COLORS } from "../utils/colors"

type CopyState = "idle" | "view" | "edit" | "error"

const CalendarSharingControls: React.FC = () => {
  const { canEdit, viewUrl, editUrl, selectedView } = useCalendar()
  const [copyState, setCopyState] = useState<CopyState>("idle")

  const withCurrentView = (url: string): string => {
    const shareUrl = new URL(url, window.location.origin)
    shareUrl.searchParams.set("view", selectedView)
    return shareUrl.toString()
  }

  const copyLink = async (label: "view" | "edit", url: string) => {
    const shareUrl = withCurrentView(url)
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyState(label)
      window.setTimeout(() => setCopyState("idle"), 2500)
    } catch (error) {
      console.error("Failed to copy calendar link:", error)
      setCopyState("error")
      window.prompt("Copy this calendar link", shareUrl)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        marginBottom: "20px",
      }}
    >
      <button
        onClick={() => void copyLink("view", viewUrl)}
        style={{
          padding: "10px 18px",
          fontSize: "14px",
          fontWeight: "bold",
          backgroundColor: UI_COLORS.button.primary.normal,
          color: UI_COLORS.text.white,
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "background-color 0.2s ease",
          touchAction: "auto",
        }}
      >
        Copy view link
      </button>

      {canEdit && editUrl ? (
        <button
          onClick={() => void copyLink("edit", editUrl)}
          style={{
            padding: "10px 18px",
            fontSize: "14px",
            fontWeight: "bold",
            backgroundColor: UI_COLORS.button.success.normal,
            color: UI_COLORS.text.white,
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            transition: "background-color 0.2s ease",
            touchAction: "auto",
          }}
        >
          Copy edit link
        </button>
      ) : null}

      <span style={{ color: UI_COLORS.text.secondary, fontSize: "13px", minWidth: "150px" }}>
        {copyState === "view"
          ? "View link copied."
          : copyState === "edit"
            ? "Edit link copied."
            : copyState === "error"
              ? "Copy failed, link shown in prompt."
              : ""}
      </span>
    </div>
  )
}

export default CalendarSharingControls
