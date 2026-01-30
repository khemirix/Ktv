# Netflix-Style Focus Navigation System

A comprehensive, reusable focus-based navigation manager optimized for TV remotes and keyboard navigation.

## Overview

This system provides Netflix-like grid navigation with:
- **Row/Column Focus Tracking**: Maintains focus position across rows
- **Smart Scrolling**: Automatic horizontal and vertical scrolling
- **Smooth Animations**: Cubic-bezier easing for natural motion
- **Safe Focus Clamping**: Prevents out-of-bounds focus
- **Optimized for TV**: 1920×1080 resolution, no external dependencies

## Architecture

### Three Components

1. **navigation.js** - `FocusNav` object (reusable manager)
2. **app.js** - Application integration and row registration
3. **style.css** - Focus animations and scaling effects

## API Documentation

### Initialization

```javascript
// Initialize the navigation system
FocusNav.init('.content-container');

// Configure settings
FocusNav.configure({
  scrollBehavior: 'smooth',      // 'smooth' or 'auto'
  scrollPaddingTop: 150,          // Vertical padding (px)
  scrollPaddingBottom: 150,
  focusScale: 1.15,               // Scale factor when focused
  transitionDuration: 300,        // Animation duration (ms)
  itemScrollMargin: 50,           // Horizontal scroll margin (px)
  enableDimming: false            // Dim non-focused items
});

// Register rows (movie grids)
const rows = document.querySelectorAll('.movie-grid');
FocusNav.registerRows(rows);
```

### Navigation Methods

```javascript
// Move focus in a direction
FocusNav.focusLeft();               // Move left in current row
FocusNav.focusRight();              // Move right in current row
FocusNav.focusUp();                 // Move to previous row (maintains column)
FocusNav.focusDown();               // Move to next row (maintains column)

// Jump to specific position
FocusNav.focusItem(rowIndex, colIndex);

// Activate focused item (trigger click)
FocusNav.activateFocused();

// Get current position
const focus = FocusNav.getCurrentFocus();
// Returns: { rowIndex: 0, colIndex: 5, element: HTMLElement }
```

### Query Methods

```javascript
// Get cards in a row
const cards = FocusNav.getCardsInRow(rowIndex);

// Get maximum valid column index
const max = FocusNav.getMaxColIndex(rowIndex);

// Access state
const { rowIndex, colIndex, rows } = FocusNav.state;
```

### Lifecycle Methods

```javascript
// Reset focus to origin
FocusNav.reset();

// Cleanup and destroy
FocusNav.destroy();

// Configure custom settings
FocusNav.configure({ focusScale: 1.2 });

// Access configuration
const config = FocusNav.CONFIG;
```

## Keyboard Controls

| Key | Action |
|-----|--------|
| ← Arrow Left | Move focus left within row |
| → Arrow Right | Move focus right within row |
| ↑ Arrow Up | Move to previous row |
| ↓ Arrow Down | Move to next row |
| ENTER | Activate/click focused item |
| SPACE | Activate/click focused item |
| ESC / BACKSPACE | Go back |

## Focus Behavior

### Vertical Movement (Up/Down)
- Maintains the same column index when possible
- Automatically clamps to valid range if next row is shorter
- Smooth vertical scrolling keeps focused item centered

### Horizontal Movement (Left/Right)
- Moves one item at a time within current row
- Stops at row boundaries (no wrapping)
- Smooth horizontal scrolling keeps item in viewport

### Smart Scrolling
1. **Horizontal**: Items stay centered in view with 50px margin
2. **Vertical**: Focused row stays 150px from top/bottom
3. **No Jank**: Uses CSS transitions and `will-change` optimization

## CSS Classes & States

### Focus Styling

```css
/* Applied to focused card */
.movie-card.focused {
  transform: scale(1.15);           /* Enlarge */
  z-index: 1000;                    /* Raise above others */
  box-shadow: 0 20px 60px ...;      /* Elevated shadow */
  outline: 4px solid var(--primary); /* Red outline */
}

/* Overlay becomes visible on focus */
.movie-card.focused .movie-card-overlay {
  opacity: 1;
  background: linear-gradient(...);
}
```

### Transitions

- **Duration**: 300ms (configurable)
- **Easing**: cubic-bezier(0.25, 0.46, 0.45, 0.94) - natural motion
- **Properties**: transform, z-index, box-shadow, outline

## Integration with App

### 1. Register Rows After Content Load

```javascript
function registerFocusNavigation() {
  const movieGrids = Array.from(
    document.querySelectorAll('.movie-grid')
  );
  FocusNav.reset();
  FocusNav.registerRows(movieGrids);
  FocusNav.focusItem(0, 0);  // Start at first item
}

// Call after rendering content
await loadMovies();
registerFocusNavigation();
```

### 2. Handle Tab Switching

```javascript
tabBtn.addEventListener('click', () => {
  renderContent(tab);
  registerFocusNavigation();  // Re-register rows
});
```

### 3. Handle Search

```javascript
searchInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    await loadSearch(query);
    registerFocusNavigation();
  }
});
```

## Performance Optimization

### CSS Optimization
- `will-change` on `.movie-card` for smooth animations
- GPU-accelerated `transform` instead of position/size
- Lazy loading for images with `loading="lazy"`
- CSS scrollbar styling instead of JavaScript

### JavaScript Optimization
- Debounced navigation with 300ms transition lock
- Single event listener for all keyboard input
- Efficient DOM queries (cached selectors)
- No polling or timers
- Minimal repaints/reflows

### TV Resolution Support
- Grid designed for 1920×1080 minimum
- 220px base card width (scales with viewport)
- 330px card height for 16:9 posters
- Padding and margins scale responsively

## Configuration Examples

### Slower Animation (300ms → 500ms)
```javascript
FocusNav.configure({
  transitionDuration: 500
});
```

### Larger Focus Scale (1.15 → 1.3)
```javascript
FocusNav.configure({
  focusScale: 1.3
});
```

### Enable Dimming
```javascript
FocusNav.configure({
  enableDimming: true  // Dim other cards
});
```

### Auto Mode (No Smooth Scroll)
```javascript
FocusNav.configure({
  scrollBehavior: 'auto'
});
```

## Testing Keyboard Navigation

Press and hold to test rapid key input:
- Hold ← / → to scroll rows left/right
- Hold ↑ / ↓ to scroll between rows
- Press ENTER to play focused content
- Press ESC to exit player

## Browser Support

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Smart TV browsers (Samsung Tizen, LG WebOS, Android TV)
- ✅ Requires `scrollIntoView()` with `inline` parameter

## Known Limitations

1. **Horizontal Overflow**: Works best with CSS `overflow-x: auto` on `.movie-grid`
2. **Row Height Variation**: Clamping works but may skip items if rows differ greatly
3. **Dynamic Content**: Must call `registerRows()` again after adding/removing rows
4. **Touch Devices**: Navigation works but not optimized for touch (use mouse/keyboard)

## Advanced Usage

### Custom Focus Handler

```javascript
// Override focus behavior
const originalFocus = FocusNav.focusItem;
FocusNav.focusItem = function(row, col) {
  console.log(`Focusing: ${row}, ${col}`);
  originalFocus.call(this, row, col);
  // Additional logic
};
```

### Focus Change Callback

```javascript
// Monitor focus changes
setInterval(() => {
  const focus = FocusNav.getCurrentFocus();
  console.log('Current focus:', focus);
}, 500);
```

### Dynamic Row Addition

```javascript
// After dynamically adding rows
const newRows = Array.from(
  document.querySelectorAll('.movie-grid')
);
FocusNav.registerRows(newRows);
```

## Troubleshooting

### Focus Not Visible
- Check `.movie-card.focused` CSS is loaded
- Verify `z-index: 1000` is applied
- Ensure outline has sufficient contrast

### Scrolling Not Working
- Confirm `.movie-grid` has `overflow-x: auto`
- Check `scroll-behavior: smooth` is set
- Verify container has `display: grid`

### Keyboard Not Responding
- Ensure `FocusNav.init()` is called before key events
- Check `navigation.js` loads before `app.js`
- Verify no event listeners prevent propagation

### Performance Issues
- Disable dimming: `enableDimming: false`
- Use `scrollBehavior: 'auto'` instead of smooth
- Check for too many event listeners
- Profile with DevTools Performance tab

## Future Enhancements

- [ ] Touch/swipe support for mobile
- [ ] Voice control integration
- [ ] Haptic feedback API
- [ ] Focus history (back button)
- [ ] Custom easing functions
- [ ] Focus animations (pulse, glow)
- [ ] Wrap-around navigation option
- [ ] Category shortcuts (keyboard numbers)

---

**Version**: 1.0.0  
**Last Updated**: January 30, 2026  
**License**: MIT
