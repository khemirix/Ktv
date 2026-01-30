# Visual Architecture & Flow Diagrams

## 1. Navigation Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INPUT                              │
│            (Keyboard / TV Remote Control)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Key Events  │
                    │ ↑ ↓ ← →    │
                    │ ENTER ESC   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────────────────┐
                    │ FocusNav.handleKeyDown()│
                    │ (Global listener)       │
                    └──────┬──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼─────┐    ┌──────▼─────┐    ┌─────▼────┐
   │ Move Left │    │  Move Up   │    │Activate  │
   │focusLeft()│    │ focusUp()  │    │activateFocused()
   │col -= 1   │    │row -= 1    │    │.click()  │
   └────┬─────┘    └──────┬─────┘    └─────┬────┘
        │                  │                 │
        └──────────────────┼─────────────────┘
                           │
              ┌────────────▼────────────┐
              │ updateFocusDisplay()    │
              ├─────────────────────────┤
              │ 1. Clear old focus      │
              │ 2. Get focused card     │
              │ 3. Add .focused class   │
              │ 4. Scale transform      │
              │ 5. scrollIntoView()     │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐     ┌──────▼──────┐    ┌───▼────┐
    │  CSS    │     │  DOM Class  │    │Scroll  │
    │Transform│     │  .focused   │    │ Page   │
    │scale()  │     │    Added    │    │Smooth  │
    └─────────┘     └─────────────┘    └────────┘
```

---

## 2. Focus State Management

```
┌─────────────────────────────────────────────────┐
│           FocusNav.state Object                 │
├─────────────────────────────────────────────────┤
│ isInitialized: boolean      ← System ready?    │
│ rowIndex: 0 (0-based)       ← Current row      │
│ colIndex: 0 (0-based)       ← Current column   │
│ rows: [HTMLElement...]      ← Registered rows  │
│ container: HTMLElement      ← Main container   │
│ focusedElement: HTMLElement ← Current card     │
│ isTransitioning: boolean    ← Debounce flag    │
└─────────────────────────────────────────────────┘
                      │
                      │ Listeners
                      │
    ┌─────────────────┴─────────────────┐
    │                                   │
┌───▼──────────────┐          ┌────────▼────────┐
│ Column Change    │          │  Row Change     │
├──────────────────┤          ├─────────────────┤
│ focusLeft()      │          │ focusUp()       │
│ colIndex--       │          │ rowIndex--      │
│ clamp(0, max)    │          │ clamp(0, length)│
│                  │          │ clamp col       │
│ focusRight()     │          │                 │
│ colIndex++       │          │ focusDown()     │
│ clamp(0, max)    │          │ rowIndex++      │
│                  │          │ clamp(0, length)│
│                  │          │ clamp col       │
└──────────────────┘          └─────────────────┘
```

---

## 3. Grid Layout Structure

```
                          VIEWPORT (1920x1080)

    ┌─────────────────────────────────────────────────┐
    │                 Navigation Bar                  │
    │           [Movies] [TV Shows]  [Search]         │
    └─────────────────────────────────────────────────┘
    │
    │                    ROWS
    │
    ├──┬────────────────────────────────────────────┐
    │  │         MOVIE-GRID (Row 0)                 │ ← overflow-x: auto
    │  │  ┌──┐  ┌──┐  ┌──┐ ┌───┐  ┌──┐  ┌──┐       │
    │  │  │  │  │  │  │  │ │***│  │  │  │  │  ...  │
    │  │  │  │  │  │  │  │ │ F │  │  │  │  │       │  ◄─ FOCUSED CARD
    │  │  │  │  │  │  │  │ │***│  │  │  │  │       │     scaled 1.15x
    │  │  └──┘  └──┘  └──┘ └───┘  └──┘  └──┘       │
    │  │  220x330px gap: 2rem                       │
    │  └────────────────────────────────────────────┘
    │
    ├──┬────────────────────────────────────────────┐
    │  │         MOVIE-GRID (Row 1)                 │ ← overflow-x: auto
    │  │  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐       │
    │  │  │  │  │  │  │  │  │  │  │  │  │  │  ...  │
    │  │  │  │  │  │  │  │  │  │  │  │  │  │       │
    │  │  └──┘  └──┘  └──┘  └──┘  └──┘  └──┘       │
    │  │                                            │
    │  └────────────────────────────────────────────┘
    │
    ├──┬────────────────────────────────────────────┐
    │  │         MOVIE-GRID (Row 2)                 │ ← overflow-x: auto
    │  │  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐             │
    │  │  │  │  │  │  │  │  │  │  │  │  ...        │
    │  │  │  │  │  │  │  │  │  │  │  │             │
    │  │  └──┘  └──┘  └──┘  └──┘  └──┘             │
    │  │                                            │
    │  └────────────────────────────────────────────┘
    │
    │                  ... more rows ...
    │
    └─────────────────────────────────────────────────┘

PAGE VERTICAL SCROLL
    ↕️ 150px padding top/bottom keeps focused row in view
```

---

## 4. Focus Animation Timeline

```
TIME: 0ms ────────────────────────── 300ms

[Card at Start]         [Animation]         [Card at Focus]
┌──┐                                        ┌────┐
│  │                                        │    │
│  │  ──────────────────────────────────▶  │    │  scale: 1.15
│  │                                        │    │
│  │                                        └────┘
└──┘                                        outline: red
                                            z-index: 1000

cubic-bezier(0.25, 0.46, 0.45, 0.94)
      "Easing curve for natural motion"

    Acceleration ──▶  Deceleration
         |                 |
    Start slow      End slow, natural feel
```

---

## 5. Column Preservation on Vertical Movement

```
SCENARIO: User navigates DOWN from Row 0, Column 2

Before Move:
Row 0:  [A] [B] [C] [D] [E]
            ↑
        colIndex = 2

            Press ↓ Down

After Move:
Row 1:  [X] [Y] [Z] [W] [V] [U]
            ↑
        colIndex = 2 PRESERVED!

        
Edge Case: Next row has fewer items

Before Move:
Row 0:  [A] [B] [C] [D] [E]
                ↑
            colIndex = 2

            Press ↓ Down

After Move:
Row 1:  [X] [Y]
            ↑
        colIndex = 2 requested
        but max index = 1 (only 2 items)
        SO: clamp to 1 ← SAFE HANDLING
```

---

## 6. Scrolling Behavior

```
HORIZONTAL SCROLL (Within Row)

Row viewport:  |───────────────────────|

Cards:  [A][B][C][D][E][F]...[Z]

User navigates right to card [M]

┌─────────────────────────────────────┐
│ scrollIntoView({                    │
│   inline: 'center',  ◄─ CENTER IN ROW
│   behavior: 'smooth' ◄─ 300MS ANIM
│ })                                  │
└─────────────────────────────────────┘

RESULT:
|           [M]           |
 └── 50px margin ──┘


VERTICAL SCROLL (Between Rows)

Viewport:  ┌───────────────────┐
           │  TOP (150px pad)  │
           │  ┌─────────────┐  │
           │  │   ROW N     │  │ ◄─ Keep visible
           │  └─────────────┘  │
           │ BOTTOM (150px pad)│
           └───────────────────┘
```

---

## 7. Event Handling Architecture

```
┌───────────────────────────────────────────────┐
│         GLOBAL KEYBOARD LISTENER              │
│    window.addEventListener('keydown', ...)    │
└──────────────────────┬────────────────────────┘
                       │
                ┌──────▼──────┐
                │ Is fullscreen?
                │ (player open)
                └──────┬──────┘
            YES │      │ NO
               │       │
         ┌─────▼─┐     │
         │IGNORE │     │
         └───────┘     │
              ┌────────▼────────┐
              │ Is input field?  │
              └────────┬────────┘
          YES │        │ NO
             │         │
        ┌────▼──┐      │
        │HANDLE │      │
        │TYPING │      │
        └───────┘      │
              ┌────────▼────────┐
              │ Is arrow key?   │
              │ ← ↑ → ↓         │
              └────────┬────────┘
          YES │        │ NO
             │         │
        ┌────▼────┐    │
        │UPDATE   │    │
        │POSITION │    │
        └─────────┘    │
                       │
              ┌────────▼────────┐
              │ Is ENTER/SPACE? │
              └────────┬────────┘
          YES │        │ NO
             │         │
        ┌────▼────┐    │
        │ACTIVATE │    │
        │CARD     │    │
        └─────────┘    │
                       │
              ┌────────▼────────┐
              │ Is ESC/BACKSP?  │
              └────────┬────────┘
          YES │        │ NO
             │         │
        ┌────▼────┐    │
        │GO BACK  │    │
        │         │    │
        └─────────┘    │
                       │
                    IGNORE
```

---

## 8. Performance Profile

```
TYPICAL FOCUS MOVEMENT: Arrow Down

Timeline:
┌──────────────────────────────────────┐
│ t=0ms   Key Press                    │
├──────────────────────────────────────┤
│ t=0-5ms   handleKeyDown()            │  Instant
│           focusDown()                │
│           updateFocusDisplay()       │
├──────────────────────────────────────┤
│ t=5-300ms Browser Animation          │  Smooth 60fps
│           CSS transform: scale()     │  (transform only)
│           Page scroll                │  (native scroll)
├──────────────────────────────────────┤
│ t=300ms   Animation complete         │  Focus visible
│           Ready for next input       │
├──────────────────────────────────────┤
│ TOTAL: 300ms (debounce period)       │
│ CPU: <2% during animation            │
│ Memory: No allocation                │
└──────────────────────────────────────┘
```

---

## 9. CSS Transform Optimization

```
WHAT NOT TO DO: Reflows page
┌─────────────────────────────────┐
│ .movie-card:focus {             │
│   position: absolute;  ◄─ REFLOW│
│   width: 252px;        ◄─ REFLOW│
│   height: 380px;       ◄─ REFLOW│
│   left: 100px;         ◄─ REFLOW│
│   top: 50px;           ◄─ REFLOW│
│ }                               │
│                                 │
│ RESULT: 60fps → 30fps! SLOW ✗  │
└─────────────────────────────────┘

WHAT TO DO: GPU accelerated
┌─────────────────────────────────┐
│ .movie-card {                   │
│   will-change: transform,z-index│
│   transform-origin: center;     │
│ }                               │
│                                 │
│ .movie-card.focused {           │
│   transform: scale(1.15);  ◄─ NO REFLOW
│   z-index: 1000;           ◄─ NO REFLOW
│   box-shadow: ...;         ◄─ COMPOSITE ONLY
│ }                               │
│                                 │
│ RESULT: 60fps maintained! ✅   │
└─────────────────────────────────┘
```

---

## 10. API Call Chain Example

```
User presses RIGHT arrow
    │
    ▼
window.keydown event
    │
    ▼
FocusNav.handleKeyDown(event)
    │
    ├─ event.key === 'ArrowRight'?
    │   YES
    ▼
FocusNav.focusRight()
    │
    ├─ withTransitionLock(callback)
    │   Lock active (300ms debounce)
    │   │
    │   ├─ state.colIndex < max?
    │   │   YES
    │   │   │
    │   │   ▼
    │   │   state.colIndex++
    │   │   │
    │   │   ▼
    │   └─ updateFocusDisplay()
    │       │
    │       ├─ Clear old focus
    │       │   querySelectorAll('.focused')
    │       │   .forEach(el => el.classList.remove('focused'))
    │       │
    │       ├─ Get new focused card
    │       │   cards[state.colIndex]
    │       │
    │       ├─ Apply focus class
    │       │   card.classList.add('focused')
    │       │   card.style.transform = 'scale(1.15)'
    │       │   card.style.zIndex = '1000'
    │       │
    │       ├─ Scroll into view
    │       │   card.scrollIntoView({
    │       │     behavior: 'smooth',
    │       │     inline: 'center'
    │       │   })
    │       │
    │       └─ Done!
    │
    └─ Unlock (after 300ms)
       Ready for next input
```

---

These diagrams help visualize:
- The data flow through the system
- How focus state is managed
- The visual scaling and animations
- The scrolling behavior
- Performance optimization techniques
- The event handling pipeline

---

**Use these diagrams as reference when:**
- Explaining the system to team members
- Debugging navigation issues
- Optimizing performance
- Extending functionality
- Training new developers

---

**Version**: 1.0.0  
**Last Updated**: January 30, 2026
