/**
 * Netflix-Style Focus Navigation Manager
 * 
 * Handles TV remote (keyboard) navigation with:
 * - Row/Column focus tracking
 * - Smooth horizontal scrolling within rows
 * - Automatic vertical scrolling between rows
 * - Smart focus clamping and wrapping
 * - Optimized for 1920x1080 TV resolution
 * 
 * Usage:
 *   FocusNav.init(containerSelector)
 *   FocusNav.registerRows(rowElements)
 *   FocusNav.focusItem(rowIndex, colIndex)
 */
const FocusNav = (function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION & STATE
  // ============================================================================

  const CONFIG = {
    scrollBehavior: 'smooth',        // 'smooth' or 'auto'
    scrollPaddingTop: 150,            // Vertical scroll padding (px)
    scrollPaddingBottom: 150,
    focusScale: 1.15,                 // Focus scaling factor
    transitionDuration: 300,          // Animation duration (ms)
    itemScrollMargin: 50,             // Horizontal scroll margin (px)
    rowHeight: 350,                   // Approximate row height for scrolling
    enableDimming: true,              // Dim non-focused items
    autoPlayOnFocus: false             // Auto-play video on focus
  };

  const state = {
    isInitialized: false,
    rowIndex: 0,                      // Currently focused row
    colIndex: 0,                      // Currently focused column within row
    rows: [],                          // Array of row DOM elements
    container: null,                   // Main container element
    focusedElement: null,              // Currently focused card element
    isTransitioning: false             // Prevent key mashing
  };

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Get all card elements from a row
   */
  function getCardsInRow(rowIndex) {
    if (!state.rows[rowIndex]) return [];
    const row = state.rows[rowIndex];
    return Array.from(row.querySelectorAll('.movie-card'));
  }

  /**
   * Get the maximum column index for a given row
   */
  function getMaxColIndex(rowIndex) {
    const cards = getCardsInRow(rowIndex);
    return Math.max(0, cards.length - 1);
  }

  /**
   * Clamp column index to valid range
   */
  function clampColIndex(rowIndex, colIndex) {
    const max = getMaxColIndex(rowIndex);
    return Math.max(0, Math.min(colIndex, max));
  }

  /**
   * Get the focused card element at current position
   */
  function getFocusedCard() {
    const cards = getCardsInRow(state.rowIndex);
    return cards[state.colIndex] || null;
  }

  /**
   * Smooth scroll element into view with custom padding
   */
  function scrollIntoViewWithPadding(element, horizontal = true) {
    if (!element) return;

    const container = element.closest('.movie-grid');
    if (container && horizontal) {
      // Horizontal scroll within row
      const cardRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      if (cardRect.left < containerRect.left + CONFIG.itemScrollMargin) {
        element.scrollIntoView({
          behavior: CONFIG.scrollBehavior,
          inline: 'start',
          block: 'nearest'
        });
        // Add margin after scroll
        setTimeout(() => {
          container.scrollLeft -= CONFIG.itemScrollMargin;
        }, 50);
      } else if (cardRect.right > containerRect.right - CONFIG.itemScrollMargin) {
        element.scrollIntoView({
          behavior: CONFIG.scrollBehavior,
          inline: 'end',
          block: 'nearest'
        });
        setTimeout(() => {
          container.scrollLeft += CONFIG.itemScrollMargin;
        }, 50);
      }
    }

    // Vertical scroll for page
    const rect = element.getBoundingClientRect();
    if (rect.top < CONFIG.scrollPaddingTop) {
      element.scrollIntoView({
        behavior: CONFIG.scrollBehavior,
        block: 'start'
      });
    } else if (rect.bottom > window.innerHeight - CONFIG.scrollPaddingBottom) {
      element.scrollIntoView({
        behavior: CONFIG.scrollBehavior,
        block: 'end'
      });
    }
  }

  /**
   * Update focus visual state
   */
  function updateFocusDisplay() {
    // Clear all focus states
    document.querySelectorAll('.movie-card').forEach(card => {
      card.classList.remove('focused');
      card.style.transform = '';
      card.style.zIndex = '';
    });

    // Get current focused card
    const card = getFocusedCard();
    if (!card) return;

    // Apply focus state
    card.classList.add('focused');
    card.style.transform = `scale(${CONFIG.focusScale})`;
    card.style.zIndex = '1000';
    state.focusedElement = card;

    // Apply dimming if enabled
    if (CONFIG.enableDimming) {
      const row = state.rows[state.rowIndex];
      if (row) {
        getCardsInRow(state.rowIndex).forEach(c => {
          c.style.opacity = c === card ? '1' : '0.5';
          c.style.filter = c === card ? 'brightness(1)' : 'brightness(0.8)';
        });
      }
    }

    // Scroll into view
    scrollIntoViewWithPadding(card, true);
  }

  /**
   * Prevent rapid key presses (debounce navigation)
   */
  async function withTransitionLock(callback) {
    if (state.isTransitioning) return;
    state.isTransitioning = true;
    callback();
    await new Promise(r => setTimeout(r, CONFIG.transitionDuration));
    state.isTransitioning = false;
  }

  // ============================================================================
  // NAVIGATION METHODS
  // ============================================================================

  /**
   * Move focus left within current row
   */
  function focusLeft() {
    withTransitionLock(() => {
      if (state.colIndex > 0) {
        state.colIndex--;
      }
      updateFocusDisplay();
    });
  }

  /**
   * Move focus right within current row
   */
  function focusRight() {
    withTransitionLock(() => {
      const max = getMaxColIndex(state.rowIndex);
      if (state.colIndex < max) {
        state.colIndex++;
      }
      updateFocusDisplay();
    });
  }

  /**
   * Move focus up to previous row (maintains column if possible)
   */
  function focusUp() {
    withTransitionLock(() => {
      if (state.rowIndex > 0) {
        state.rowIndex--;
        // Clamp column to valid range for new row
        state.colIndex = clampColIndex(state.rowIndex, state.colIndex);
      }
      updateFocusDisplay();
    });
  }

  /**
   * Move focus down to next row (maintains column if possible)
   */
  function focusDown() {
    withTransitionLock(() => {
      if (state.rowIndex < state.rows.length - 1) {
        state.rowIndex++;
        // Clamp column to valid range for new row
        state.colIndex = clampColIndex(state.rowIndex, state.colIndex);
      }
      updateFocusDisplay();
    });
  }

  /**
   * Jump to specific position
   */
  function focusItem(rowIndex, colIndex) {
    state.rowIndex = Math.max(0, Math.min(rowIndex, state.rows.length - 1));
    state.colIndex = clampColIndex(state.rowIndex, colIndex);
    updateFocusDisplay();
  }

  /**
   * Get current focus position
   */
  function getCurrentFocus() {
    return {
      rowIndex: state.rowIndex,
      colIndex: state.colIndex,
      element: getFocusedCard()
    };
  }

  /**
   * Activate currently focused item (trigger click)
   */
  function activateFocused() {
    const card = getFocusedCard();
    if (card) {
      // Default behavior: trigger native click on the focused card
      card.click();
    }
  }

  /**
   * Handle keyboard input
   */
  function handleKeyDown(event) {
    // Don't interfere with input fields
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        document.activeElement.blur();
        return;
      }
      // Allow other keys in input
      return;
    }

    // Don't interfere with fullscreen player
    if (document.fullscreenElement) {
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        focusLeft();
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusRight();
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusUp();
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusDown();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activateFocused();
        break;
      case 'Escape':
      case 'Backspace':
        event.preventDefault();
        handleBack();
        break;
      default:
        return;
    }
  }

  /**
   * Handle back/escape
   */
  function handleBack() {
    // Could implement overlays or navigation history here
    if (document.fullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || 
                   document.mozCancelFullScreen || document.msExitFullscreen;
      if (exit) exit.call(document).catch(() => {});
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize navigation system
   */
  function init(containerSelector = '.content-container') {
    if (state.isInitialized) return;

    state.container = document.querySelector(containerSelector);
    if (!state.container) {
      console.warn(`FocusNav: Container not found: ${containerSelector}`);
      return;
    }

    // Register keyboard handler
    window.addEventListener('keydown', handleKeyDown);

    state.isInitialized = true;
    console.log('FocusNav: Navigation system initialized');
  }

  /**
   * Register row elements for navigation
   */
  function registerRows(rowElements) {
    // Accept jQuery-like collections or arrays
    if (rowElements && rowElements.length !== undefined) {
      state.rows = Array.from(rowElements);
    } else if (rowElements instanceof NodeList) {
      state.rows = Array.from(rowElements);
    } else {
      state.rows = rowElements;
    }

    state.rowIndex = 0;
    state.colIndex = 0;

    // Make cards focusable
    state.rows.forEach(row => {
      getCardsInRow(state.rows.indexOf(row)).forEach((card, idx) => {
        card.setAttribute('tabindex', '-1');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `${card.textContent || 'Item'} ${idx + 1}`);
      });
    });

    // Apply initial focus
    updateFocusDisplay();
    console.log(`FocusNav: Registered ${state.rows.length} rows`);
  }

  /**
   * Reset navigation state
   */
  function reset() {
    state.rowIndex = 0;
    state.colIndex = 0;
    state.focusedElement = null;
    state.isTransitioning = false;
    updateFocusDisplay();
  }

  /**
   * Destroy/cleanup
   */
  function destroy() {
    window.removeEventListener('keydown', handleKeyDown);
    state.isInitialized = false;
  }

  /**
   * Configure settings
   */
  function configure(options) {
    Object.assign(CONFIG, options);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    // Initialization
    init,
    destroy,
    configure,
    registerRows,
    reset,

    // Navigation
    focusLeft,
    focusRight,
    focusUp,
    focusDown,
    focusItem,
    activateFocused,

    // State queries
    getCurrentFocus,
    getCardsInRow,
    getMaxColIndex,

    // Config access
    CONFIG,
    state: state
  };
})();

// Legacy compatibility alias
const NAV = FocusNav;
