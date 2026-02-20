# Responsive Navigation & Typography Checklist

Use this quick pass before shipping navbar or text-size changes.

## Breakpoint sweep (desktop → mobile)
- [ ] 1280px: Main nav items + right-side user actions fully visible.
- [ ] 1200px: No clipping on right edge; no overlap between logo and nav items.
- [ ] 1100px: Desktop mode still readable and stable.
- [ ] 1050px: Last width where desktop user actions are expected to remain visible.
- [ ] 1040px: Tablet menu fallback active (hamburger/user menu), no horizontal scroll.
- [ ] 1000px: Dropdown menu fully inside viewport.
- [ ] 900px / 768px / 480px: Mobile menu opens cleanly; all links reachable.

## Logout-specific checks
- [ ] "Log Out" remains one line in desktop and menu contexts.
- [ ] No truncation, clipping, or wrap for "Log Out" near 1000–1100px.
- [ ] Logout link remains clickable after menu open/close cycles.

## Overflow and layout checks
- [ ] `body` has no horizontal scroll at tested widths.
- [ ] Right-most nav content never renders off-screen.
- [ ] Dropdown panels stay inside viewport bounds.
- [ ] Long usernames do not break layout (desktop + menu).

## Typography checks
- [ ] Body text remains comfortably readable at all major breakpoints.
- [ ] Small helper labels do not drop below readable size.
- [ ] Buttons/controls do not grow large enough to push layout off-screen.

## Quick interaction checks
- [ ] Keyboard tab order reaches nav links and logout link.
- [ ] Hover/focus states remain visible for nav items.
- [ ] Menu closes/open behaves correctly after route changes.
