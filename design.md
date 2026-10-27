# Design: Маяк

## System
- Scope: app screen. Full redesign of the course shell, learning route, reading and reports.
- Genre: modern-minimal. Console material, adapted to the course's existing green signal.
- Default dark, optional light; preference key stays mayak-course-theme.
- Still interface: no decorative animation, hero, stock photography or invented progress.
- Real content: 82 lessons and the user's own observations and reports.

## Tokens
- Source of truth: content/course/ui/tokens.css.
- Three neutral graphite surfaces; pale ink, muted secondary text, green action and selection.
- Light values are explicit theme tokens. Print is white paper.
- Segoe UI/system sans for Cyrillic reading, offline; Cascadia Code/Consolas for commands and measurements.
- Fixed app type scale, 16px body, 68ch prose. No external font dependency.
- Spacing scale from Hallmark scaffold. Shared 6px controls and 10px independent panels.

## Layout
- One centred, capped 1440px shell. Curriculum sidebar is earned by ten destinations.
- Under 60rem the sidebar becomes a native disclosure.
- Course index is ordered rows, not a wall of cards.
- Lessons use a reading column and contents rail; the rail becomes inline on smaller screens.
- Reading sections are separated by space and rules. Forms and reports retain all existing IDs.

## Controls
- One green primary action; neutral secondary controls and native accessible fields.
- Focus is immediate and visible. Active, disabled, loading and error styles follow actual state.
- Search, progress, report import and offline storage retain their existing behaviour.

## Preservation
- Never alter lesson material, assessment answers, progress keys or user note storage for a visual change.
- Previous edition remains archived. Historical reports are never converted into new lab credit.

## Verification
- npm run build, npm run validate, npm run test:course.
- Also check BASE_PATH=/Learning-individual and restore the root build afterward.
- Hallmark scope app, --render --kept against the recorded representative pages.

## Exports
- content/course/ui/tokens.css and base.css.
