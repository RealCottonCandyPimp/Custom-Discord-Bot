# Changelog

All notable changes to this project will be documented here.

## Unreleased

### Added
- XP and level system (configurable XP per message, XP per level, daily XP cap, and level-up reward roles).
- `/rank` slash command to show a member’s XP and level in the current server.
- Dashboard UI to enable/configure XP and manage level role thresholds.

### Changed
- Guild settings persistence now includes XP configuration fields, with a MySQL table added for per-member XP tracking.
