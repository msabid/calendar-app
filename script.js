/*
  script.js

  Implements the data fetching, rendering and interaction logic for the
  Adaptive Calendar + Weather Dashboard. The app reads the user's
  location and unit preferences (with defaults) and requests weather
  data from Open‑Meteo (with fallback providers defined separately).
  Calendar events are stubbed for demonstration and can be replaced
  with real calendar API integrations. The layout is responsive and
  uses CSS grid; see style.css for size definitions.
*/

(function () {
  'use strict';

  // ----- Configurable defaults -----
  const DEFAULT_LAT = 44.2312;  // Kingston, Ontario (from prompt)
  const DEFAULT_LON = -76.4860;
  const DEFAULT_UNITS = 'metric';  // 'metric' or 'imperial'
  const DEFAULT_THEME = 'dark';
  const WEATHER_API = {
    primary: (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`,
    // Additional providers could be added here for fallback (e.g. WeatherAPI, OpenWeather)
  };

  // Mapping of Open‑Meteo weather codes to emoji icons for a minimal visual representation
  const WEATHER_ICONS = {
    0: '☀️', // Clear sky
    1: '☀️', // Mainly clear
    2: '⛅', // Partly cloudy
    3: '☁️', // Overcast
    45: '🌫️', // Fog
    48: '🌫️',
    51: '🌦️', // Drizzle
    53: '🌦️',
    55: '🌦️',
    56: '🌦️',
    57: '🌦️',
    61: '🌧️', // Rain
    63: '🌧️',
    65: '🌧️',
    80: '🌧️',
    81: '🌧️',
    82: '🌧️',
    66: '🌧️',
    67: '🌧️',
    71: '❄️', // Snow
    73: '❄️',
    75: '❄️',
    77: '❄️',
    85: '❄️',
    86: '❄️',
    95: '⛈️', // Thunderstorm
    96: '⛈️',
    99: '⛈️'
  };

  // Stubbed events for demonstration. This object is mutable and will be
  // populated from localStorage if available to persist user‑added events
  // across sessions. Keys are date strings in YYYY-MM-DD format.
  const STUB_EVENTS = {
    '2025-08-18': [
      { title: 'Garbage, grey bin', start: '00:00', end: '23:59', allDay: true, color: '#3EA6FF' },
      { title: 'Discovery Day', start: '00:00', end: '23:59', allDay: true, color: '#3EA6FF' },
      { title: 'Team sync', start: '09:00', end: '10:00', allDay: false, color: '#3EA6FF' },
      { title: 'Pick up groceries', start: '15:00', end: '16:00', allDay: false, color: '#3EA6FF' }
    ],
    '2025-08-19': [
      { title: 'Project review', start: '14:00', end: '15:00', allDay: false, color: '#3EA6FF' }
    ],
      '2025-08-20': [
      { title: 'Dentist Appointment', start: '11:30', end: '12:30', allDay: false, color: '#3EA6FF' },
      { title: 'Yoga class', start: '18:00', end: '19:00', allDay: false, color: '#3EA6FF' }
    ]
    // Additional stub events can be provided here.
  };

  // ----- User and Events persistence -----
  // Toggle remote storage to persist events and user data across devices. When
  // set to true, events will be loaded from and saved to a backend API
  // implemented via Netlify Functions (see netlify/functions directory). When
  // false, events and users are stored in browser localStorage only. You can
  // switch this to true once your Netlify deployment is configured with
  // environment variables pointing at a Neon database.
  // Toggle remote storage to persist events and user data across devices.
  // When enabled, events and authentication will be handled via Netlify
  // serverless functions backed by your Neon database. This should be
  // set to true for cross‑browser synchronisation. If you prefer local
  // storage only, set to false.
  const USE_REMOTE_STORAGE = true;

  /**
   * Call the remote authentication endpoint. When remote storage is
   * enabled (USE_REMOTE_STORAGE = true), all auth actions are
   * delegated to the serverless function at /.netlify/functions/auth.
   * The function accepts an action string (signup, login,
   * changePassword) and associated username/password fields. It
   * returns a promise that resolves with the parsed JSON response.
   *
   * @param {string} action The auth action to perform (signup, login, changePassword)
   * @param {string} username The username
   * @param {string} password The current password (if required)
   * @param {string} newPassword The new password (for changePassword)
   * @returns {Promise<Object>} A promise resolving with the JSON response
   */
  async function remoteAuth(action, username, password, newPassword) {
    try {
      const payload = { action, username };
      if (password) payload.password = password;
      if (newPassword) payload.newPassword = newPassword;
      const resp = await fetch('/.netlify/functions/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await resp.json();
    } catch (err) {
      console.error('Remote auth error', err);
      return { error: err.message };
    }
  }

  /*
    Load the users object from localStorage. The users object maps
    usernames to user metadata such as password hashes. If no users
    are stored, return an empty object. User credentials are stored
    as plain strings for demonstration purposes; in a production
    environment consider hashing passwords on the server.
  */
  function loadUsers() {
    if (USE_REMOTE_STORAGE) {
      // When using remote storage, user management should occur via the
      // auth API. The front‑end always returns an empty object here and
      // relies on the auth API for validation. See authInit() for
      // integration with remote auth.
      return {};
    }
    try {
      const usersJSON = localStorage.getItem('dashboard-users');
      return usersJSON ? JSON.parse(usersJSON) : {};
    } catch (err) {
      console.error('Error loading users', err);
      return {};
    }
  }

  // Persist the users object back to localStorage. This should be
  // called after creating a new user or updating a user password.
  function saveUsers(users) {
    if (USE_REMOTE_STORAGE) {
      // Persisting users remotely is handled by the auth API. See
      // netlify/functions/auth.js for details. No action here.
      return;
    }
    try {
      localStorage.setItem('dashboard-users', JSON.stringify(users));
    } catch (err) {
      console.error('Error saving users', err);
    }
  }

  /*
    Load events for the specified user from localStorage. Events are
    stored under the key `dashboard-events-<username>`. If there is
    no data for the user, return without modifying STUB_EVENTS. This
    ensures each user has their own event collection. This function
    should be called after the user has successfully logged in.
  */
  function loadEvents(user) {
    if (!user) return;
    if (USE_REMOTE_STORAGE) {
      // Load events from the remote API. This fetches events for the
      // specified user from the server and merges them into the
      // STUB_EVENTS object. If the API call fails, the local STUB_EVENTS
      // remains unchanged (so offline editing is possible).
      fetch(`/\.netlify/functions/events?user=${encodeURIComponent(user)}`)
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
          if (data && data.events) {
            Object.keys(data.events).forEach(k => {
              STUB_EVENTS[k] = data.events[k];
            });
          }
        })
        .catch(err => {
          console.error('Error loading remote events', err);
        });
      return;
    }
    try {
      const stored = localStorage.getItem(`dashboard-events-${user}`);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach(key => {
          STUB_EVENTS[key] = parsed[key];
        });
      }
    } catch (err) {
      console.error('Error loading events for user', err);
    }
  }

  /*
    Save the current STUB_EVENTS object for the specified user. Events
    are stored under a user‑specific key to prevent cross‑user data
    contamination. Call this function whenever the events for the
    current user are modified (added, edited or deleted). If no user
    is specified, no action is taken.
  */
  function saveEvents(user) {
    if (!user) return;
    if (USE_REMOTE_STORAGE) {
      // Save events to the remote API. We send only the updated STUB_EVENTS
      // object so the server can persist the entire collection. In a more
      // sophisticated implementation you could send incremental changes.
      fetch('/.netlify/functions/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, events: STUB_EVENTS })
      }).catch(err => {
        console.error('Error saving remote events', err);
      });
      return;
    }
    try {
      localStorage.setItem(`dashboard-events-${user}`, JSON.stringify(STUB_EVENTS));
    } catch (err) {
      console.error('Error saving events for user', err);
    }
  }

  // Application state
  const state = {
    selectedDate: new Date(),
    theme: DEFAULT_THEME,
    units: DEFAULT_UNITS,
    location: { lat: DEFAULT_LAT, lon: DEFAULT_LON },
    locationName: 'Kingston, ON',
    forecast: [],
    lastWeatherUpdate: null,
    // The currently authenticated user. This is populated
    // during authInit() when a user logs in. When null,
    // the dashboard will not be shown and the auth screen
    // will be displayed instead.
    currentUser: null
  };

  // Utility: format date as YYYY-MM-DD using local timezone rather than UTC.
  // The previous implementation used toISOString(), which converts the date
  // into UTC before formatting. This caused off‑by‑one errors when the local
  // timezone was behind UTC and the time was late in the day (e.g. after 8 p.m.).
  // Using the local components ensures that "Today" always refers to the
  // calendar date the user expects.
  function toDateKey(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Utility: get day of week short name
  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Minimum width (in pixels) of a forecast tile and the typical horizontal
  // gap between tiles. These constants are used to calculate how many
  // forecast tiles can fit within the available strip width. The number of
  // visible tiles should adjust dynamically rather than being a fixed
  // constant, ensuring tiles fill the available space and additional days
  // remain scrollable.
  // Minimum width of each forecast tile. Increasing this value ensures
  // the forecast tiles remain large and legible on wider screens.
  // The value will influence how many tiles fit without scrolling.
  // Minimum width of each forecast tile. Increasing this value further reduces
  // the number of visible tiles on wider screens (e.g., 16:10 tablets) so
  // that they occupy more space and remain legible. With a width of 120px,
  // typical tablet screens will display around 3–4 tiles, with the remainder
  // scrollable.
  const WEATHER_MIN_TILE_WIDTH = 120;
  const WEATHER_TILE_GAP = 18;

  // Compute how many forecast tiles can fit in the weather strip. The
  // calculation uses the minimum tile width and the gap between tiles to
  // approximate a maximum visible count. At least one tile will always be
  // shown. This function runs at each render to adapt to viewport size
  // changes and container resizing.
  function computeForecastVisible() {
    const strip = document.getElementById('weather-strip');
    if (!strip) return 3;
    const width = strip.clientWidth;
    // Add one gap to the width to account for the last tile not needing a gap
    const visible = Math.floor((width + WEATHER_TILE_GAP) / (WEATHER_MIN_TILE_WIDTH + WEATHER_TILE_GAP));
    return Math.max(1, visible);
  }

  // Fetch weather using the primary provider
  async function fetchWeather() {
    const url = WEATHER_API.primary(state.location.lat, state.location.lon);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Weather API error');
      const data = await resp.json();
      state.forecast = data.daily; // Contains arrays: time, temperature_2m_max, temperature_2m_min, weathercode
      state.currentWeather = data.current_weather;
      state.lastWeatherUpdate = new Date();
      renderWeather();
    } catch (err) {
      console.error('Weather fetch failed', err);
      // Use fallback static data when online fetch is unavailable.
      fallbackWeather();
    }
  }

  // Render weather bar using state.forecast and state.currentWeather
  function renderWeather() {
    const today = state.currentWeather;
    // Update today display
    const tempEl = document.getElementById('today-temp');
    const dayEl = document.getElementById('today-day');
    const descEl = document.getElementById('today-desc');
    const rangeEl = document.getElementById('today-range');
    const updatedEl = document.getElementById('weather-updated');
    const now = new Date();
    // Determine day name for today
    const todayDate = new Date();
    const dow = WEEKDAYS[todayDate.getDay()];
    tempEl.textContent = Math.round(today.temperature) + '°';
    dayEl.textContent = dow;
    descEl.textContent = describeWeather(today.weathercode);
    // Range for today: we need to find in daily forecast the first index
    if (state.forecast && state.forecast.temperature_2m_max) {
      rangeEl.textContent = 'H ' + Math.round(state.forecast.temperature_2m_max[0]) + '° / L ' + Math.round(state.forecast.temperature_2m_min[0]) + '°';
    }
    // Last updated timestamp
    if (state.lastWeatherUpdate) {
      const timeStr = state.lastWeatherUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      updatedEl.textContent = 'Last updated ' + timeStr;
    }
    // Update location display
    const locEl = document.getElementById('weather-location');
    if (locEl) {
      locEl.textContent = state.locationName || '';
    }
    // Build forecast strip
    const strip = document.getElementById('weather-strip');
    strip.innerHTML = '';
    if (!state.forecast || !state.forecast.time) return;
    // We skip the first entry (today) because it's displayed in the Today block
    const totalDays = state.forecast.time.length;
    // Determine how many forecast days to display based on available width.
    const visibleCount = computeForecastVisible();
    const total = totalDays - 1;
    // Render all remaining forecast days. The first `visibleCount` entries
    // expand to fill the available space, while the rest maintain a
    // minimum width so they can be scrolled into view. This approach
    // lets the number of visible tiles adapt to the container size
    // without truncating the remainder.
    for (let i = 1; i <= total; i++) {
      const dateStr = state.forecast.time[i];
      const dateObj = new Date(dateStr);
      const code = state.forecast.weathercode[i];
      const hi = state.forecast.temperature_2m_max[i];
      const lo = state.forecast.temperature_2m_min[i];
      const dowShort = WEEKDAYS[dateObj.getDay()].toUpperCase();
      const tile = document.createElement('div');
      tile.className = 'weather-day';
      // For the first `visibleCount` tiles, allow them to grow to
      // evenly fill the available space. Subsequent tiles retain
      // auto sizing so that they appear at their natural width and
      // are accessible via horizontal scroll.
      if (i <= visibleCount) {
        tile.style.flex = '1 1 0';
      } else {
        tile.style.flex = '0 0 auto';
      }
      tile.innerHTML = `
        <div class="dow">${dowShort}</div>
        <div class="icon">${WEATHER_ICONS[code] || '🌡️'}</div>
        <div class="temps">${Math.round(hi)}°/${Math.round(lo)}°</div>
      `;
      strip.appendChild(tile);
    }
  }

  // Provide static dummy weather when API fetch is unavailable or fails. This helps
  // render a sensible UI in offline environments or when file:// origins
  // block network requests. The dummy forecast covers seven days starting
  // today with plausible temperatures and icons.
  function fallbackWeather() {
    const now = new Date();
    const dummyTimes = [];
    const maxTemps = [];
    const minTemps = [];
    const codes = [];
    // Generate seven days of dummy weather data
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      dummyTimes.push(d.toISOString().split('T')[0]);
      // Simple temperature pattern: alternating highs/lows around seasonal averages
      maxTemps.push(70 + i);
      minTemps.push(50 + i);
      // Alternate weather codes (clear, partly cloudy, rain, sunny etc.)
      const codeOptions = [1, 2, 3, 80, 0, 61, 95];
      codes.push(codeOptions[i % codeOptions.length]);
    }
    state.forecast = {
      time: dummyTimes,
      temperature_2m_max: maxTemps,
      temperature_2m_min: minTemps,
      weathercode: codes
    };
    state.currentWeather = { temperature: maxTemps[0], weathercode: codes[0] };
    state.lastWeatherUpdate = new Date();
    // Use default location name for fallback
    state.locationName = 'Kingston, ON';
    renderWeather();
  }

  // Return a textual description from weather code (simplified)
  function describeWeather(code) {
    if (code === 0 || code === 1) return 'Clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code >= 45 && code <= 48) return 'Foggy';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'Snow';
    if (code >= 95) return 'Thunderstorm';
    return 'Mixed';
  }

  // Build an array of date objects representing the visible days in the month grid
  function buildCalendarDates(year, month) {
    const dates = [];
    const firstOfMonth = new Date(year, month, 1);
    const startDay = firstOfMonth.getDay(); // 0 (Sun) - 6 (Sat)
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    // Fill in trailing days from previous month
    for (let i = startDay - 1; i >= 0; i--) {
      dates.push(new Date(year, month - 1, daysInPrevMonth - i));
    }
    // Fill in current month days
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(new Date(year, month, d));
    }
    // Fill in leading days from next month to complete 6 weeks
    const nextDays = 42 - dates.length;
    for (let n = 1; n <= nextDays; n++) {
      dates.push(new Date(year, month + 1, n));
    }
    return dates;
  }

  // Render the calendar grid based on state.selectedDate
  function renderCalendar() {
    const date = state.selectedDate;
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthNameEl = document.getElementById('calendar-month');
    const yearEl = document.getElementById('calendar-year');
    monthNameEl.textContent = date.toLocaleString('default', { month: 'long' });
    yearEl.textContent = year;
    const dates = buildCalendarDates(year, month);
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    const todayKey = toDateKey(new Date());
    dates.forEach(d => {
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      const cellKey = toDateKey(d);
      // Determine if cell is part of the current month
      const inCurrentMonth = d.getMonth() === month;
      if (!inCurrentMonth) cell.classList.add('dim');
      if (cellKey === todayKey) cell.classList.add('today');
      // Determine selected date
      const selectedKey = toDateKey(state.selectedDate);
      if (cellKey === selectedKey) {
        cell.style.outline = '2px solid var(--accent)';
        cell.style.outlineOffset = '-2px';
      }
      cell.dataset.date = cellKey;
      cell.innerHTML = `<div class="calendar-date">${d.getDate()}</div>`;
      // Add event dots
      const dayEvents = STUB_EVENTS[cellKey];
      if (dayEvents) {
        const dots = document.createElement('div');
        dots.className = 'event-dots';
        dayEvents.slice(0, 3).forEach(ev => {
          const dot = document.createElement('div');
          dot.className = 'event-dot';
          dot.style.background = ev.color || 'var(--accent)';
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
      }
      // Add click handler to select date
      cell.addEventListener('click', () => {
        // Create a new Date using year, month, day parameters to avoid timezone shift
        const parts = cell.dataset.date.split('-').map(x => parseInt(x, 10));
        const newDate = new Date(parts[0], parts[1] - 1, parts[2]);
        state.selectedDate = newDate;
        renderCalendar();
        renderPlanner();
      });
      grid.appendChild(cell);
    });
  }

  // Render the daily planner for the selected date
  function renderPlanner() {
    const headerEl = document.getElementById('planner-date');
    const allDayEl = document.getElementById('planner-all-day');
    const listEl = document.getElementById('planner-list');
    const date = state.selectedDate;
    headerEl.textContent = date.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
    // Clear previous
    allDayEl.innerHTML = '';
    listEl.innerHTML = '';
    const key = toDateKey(date);
    const events = STUB_EVENTS[key] || [];
    // Separate all-day and timed events
    const allDayEvents = events.filter(ev => ev.allDay);
    const timedEvents = events.filter(ev => !ev.allDay);
    // Render all-day events as chips and attach editing/deletion handlers.
    allDayEvents.forEach((ev) => {
      const chip = document.createElement('div');
      chip.className = 'planner-chip';
      chip.style.background = ev.color || 'var(--accent)';
      // Build chip content with icon and title
      const iconSpan = document.createElement('span');
      iconSpan.className = 'icon';
      iconSpan.textContent = '📌';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = ev.title;
      chip.appendChild(iconSpan);
      chip.appendChild(titleSpan);
      // Action icons container
      const actions = document.createElement('div');
      actions.className = 'chip-actions';
      const editIcon = document.createElement('span');
      editIcon.textContent = '✎';
      editIcon.title = 'Edit event';
      const deleteIcon = document.createElement('span');
      deleteIcon.textContent = '×';
      deleteIcon.title = 'Delete event';
      actions.appendChild(editIcon);
      actions.appendChild(deleteIcon);
      chip.appendChild(actions);
      // Delete handler
      deleteIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentKey = key;
        const eventsForDay = STUB_EVENTS[currentKey] || [];
        const idx = eventsForDay.indexOf(ev);
        if (idx > -1) eventsForDay.splice(idx, 1);
        STUB_EVENTS[currentKey] = eventsForDay;
        saveEvents(state.currentUser);
        renderPlanner();
        renderCalendar();
      });
      // Edit handler for title
      editIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentKey = key;
        const eventsForDay = STUB_EVENTS[currentKey] || [];
        const idx = eventsForDay.indexOf(ev);
        let newTitle = prompt('Edit event title (leave blank to keep existing):', ev.title);
        if (newTitle !== null) {
          newTitle = newTitle.trim();
          if (newTitle.length > 0 && idx > -1) {
            eventsForDay[idx].title = newTitle;
            STUB_EVENTS[currentKey] = eventsForDay;
            saveEvents(state.currentUser);
            renderPlanner();
            renderCalendar();
          }
        }
      });
      // Fallback click handler to allow editing/deleting via confirm if icons are not used
      chip.addEventListener('click', () => {
        const currentKey = key;
        const eventsForDay = STUB_EVENTS[currentKey] || [];
        const idx = eventsForDay.indexOf(ev);
        const del = confirm('Do you want to delete this event?\nClick OK to delete, or Cancel to edit.');
        if (del) {
          if (idx > -1) eventsForDay.splice(idx, 1);
        } else {
          let newTitle = prompt('Edit event title (leave blank to keep existing):', ev.title);
          if (newTitle !== null) {
            newTitle = newTitle.trim();
            if (newTitle.length > 0 && idx > -1) {
              eventsForDay[idx].title = newTitle;
            }
          }
        }
        STUB_EVENTS[currentKey] = eventsForDay;
        saveEvents(state.currentUser);
        renderPlanner();
        renderCalendar();
      });
      allDayEl.appendChild(chip);
    });
    // Render timed events
    timedEvents.sort((a, b) => a.start.localeCompare(b.start));
    timedEvents.forEach((ev) => {
      const item = document.createElement('div');
      item.className = 'planner-item';
      const time = document.createElement('div');
      time.className = 'planner-time';
      time.textContent = ev.start;
      const text = document.createElement('div');
      text.className = 'planner-text';
      text.textContent = ev.title;
      item.appendChild(time);
      item.appendChild(text);
      // Build actions container for edit and delete
      const actions = document.createElement('div');
      actions.className = 'actions';
      const editBtn = document.createElement('span');
      editBtn.textContent = '✎';
      editBtn.title = 'Edit event';
      const deleteBtn = document.createElement('span');
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Delete event';
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      // Append elements
      item.appendChild(actions);
      // Delete handler
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentKey = key;
        const eventsForDay = STUB_EVENTS[currentKey] || [];
        const idx = eventsForDay.indexOf(ev);
        if (idx > -1) eventsForDay.splice(idx, 1);
        STUB_EVENTS[currentKey] = eventsForDay;
        saveEvents(state.currentUser);
        renderPlanner();
        renderCalendar();
      });
      // Edit handler
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentKey = key;
        const eventsForDay = STUB_EVENTS[currentKey] || [];
        const idx = eventsForDay.indexOf(ev);
        // Edit title
        let newTitle = prompt('Edit event title (leave blank to keep existing):', ev.title);
        if (newTitle !== null) {
          newTitle = newTitle.trim();
          if (newTitle.length > 0 && idx > -1) {
            eventsForDay[idx].title = newTitle;
          }
        }
        // Edit time
        let timeInput = prompt('Enter new start and end time (HH:MM-HH:MM) or leave blank to keep existing:', `${ev.start}-${ev.end}`);
        if (timeInput !== null && timeInput.trim().length > 0 && idx > -1) {
          const parts = timeInput.split('-');
          if (parts.length === 2) {
            const newStart = parts[0].trim();
            const newEnd = parts[1].trim();
            eventsForDay[idx].start = newStart;
            eventsForDay[idx].end = newEnd;
          }
        }
        STUB_EVENTS[currentKey] = eventsForDay;
        saveEvents(state.currentUser);
        renderPlanner();
        renderCalendar();
      });
      // Fallback row click: open confirm + edit prompts
      item.addEventListener('click', () => {
        const currentKey = key;
        const eventsForDay = STUB_EVENTS[currentKey] || [];
        const idx = eventsForDay.indexOf(ev);
        const del = confirm('Do you want to delete this event?\nClick OK to delete, or Cancel to edit.');
        if (del) {
          if (idx > -1) eventsForDay.splice(idx, 1);
        } else {
          let newTitle = prompt('Edit event title (leave blank to keep existing):', ev.title);
          if (newTitle !== null) {
            newTitle = newTitle.trim();
            if (newTitle.length > 0 && idx > -1) {
              eventsForDay[idx].title = newTitle;
            }
          }
          let timeInput = prompt('Enter new start and end time (HH:MM-HH:MM) or leave blank to keep existing:', `${ev.start}-${ev.end}`);
          if (timeInput !== null && timeInput.trim().length > 0 && idx > -1) {
            const parts = timeInput.split('-');
            if (parts.length === 2) {
              eventsForDay[idx].start = parts[0].trim();
              eventsForDay[idx].end = parts[1].trim();
            }
          }
        }
        STUB_EVENTS[currentKey] = eventsForDay;
        saveEvents(state.currentUser);
        renderPlanner();
        renderCalendar();
      });
      listEl.appendChild(item);
    });
  }

  // Attach event listeners for month navigation and today buttons
  function attachListeners() {
    document.getElementById('prev-month').addEventListener('click', () => {
      const d = state.selectedDate;
      state.selectedDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      renderCalendar();
      renderPlanner();
    });
    document.getElementById('next-month').addEventListener('click', () => {
      const d = state.selectedDate;
      state.selectedDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      renderCalendar();
      renderPlanner();
    });
    document.getElementById('calendar-today').addEventListener('click', () => {
      state.selectedDate = new Date();
      renderCalendar();
      renderPlanner();
    });
    document.getElementById('planner-today').addEventListener('click', () => {
      state.selectedDate = new Date();
      renderCalendar();
      renderPlanner();
    });
    // Year toggle: prompt user for a new year
    const yearToggle = document.getElementById('calendar-year-toggle');
    if (yearToggle) {
      yearToggle.addEventListener('click', () => {
        const currentYear = state.selectedDate.getFullYear();
        const input = prompt('Enter year:', currentYear);
        if (input) {
          const newYear = parseInt(input, 10);
          if (!isNaN(newYear)) {
            const month = state.selectedDate.getMonth();
            state.selectedDate = new Date(newYear, month, 1);
            renderCalendar();
            renderPlanner();
          }
        }
      });
    }
    // Also allow clicking on the year text to change year
    const yearNameEl = document.getElementById('calendar-year');
    if (yearNameEl) {
      yearNameEl.addEventListener('click', () => {
        const currentYear = state.selectedDate.getFullYear();
        const input = prompt('Enter year:', currentYear);
        if (input) {
          const newYear = parseInt(input, 10);
          if (!isNaN(newYear)) {
            const month = state.selectedDate.getMonth();
            state.selectedDate = new Date(newYear, month, 1);
            renderCalendar();
            renderPlanner();
          }
        }
      });
    }
    // Add event button: allow user to create a new event for the selected date
    const addBtn = document.getElementById('planner-add');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const dateKey = toDateKey(state.selectedDate);
        const title = prompt('Event title:');
        if (!title) return;
        const timeRange = prompt('Start and end time (HH:MM-HH:MM), or leave blank for all-day:');
        let start = '00:00';
        let end = '23:59';
        let allDay = true;
        if (timeRange && timeRange.includes('-')) {
          const parts = timeRange.split('-');
          if (parts.length === 2) {
            start = parts[0].trim();
            end = parts[1].trim();
            allDay = false;
          }
        }
        // Insert new event into the STUB_EVENTS structure
        if (!STUB_EVENTS[dateKey]) STUB_EVENTS[dateKey] = [];
        STUB_EVENTS[dateKey].push({ title, start, end, allDay, color: '#3EA6FF' });
        // Persist new event for the current user
        saveEvents(state.currentUser);
        renderPlanner();
        renderCalendar();
      });
    }
    // Sync calendars button: stub for connecting external calendars
    const syncBtn = document.getElementById('calendar-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        alert('Calendar sync is not yet implemented. In the future, you will be able to connect Google or Outlook calendars here.');
      });
    }
    // Theme toggle button could be added here (if implemented)

    // Allow user to change location by clicking on the location text
    const locEl = document.getElementById('weather-location');
    if (locEl) {
      locEl.addEventListener('click', async () => {
        const input = prompt('Enter new location (city name or lat,lon):', state.locationName);
        if (!input) return;
        const latLonMatch = input.trim().match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        // If user enters lat,lon directly
        if (latLonMatch) {
          const lat = parseFloat(latLonMatch[1]);
          const lon = parseFloat(latLonMatch[2]);
          if (!isNaN(lat) && !isNaN(lon)) {
            state.location = { lat, lon };
            state.locationName = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            await fetchWeather();
            return;
          }
        }
        // Otherwise use geocoding to find coordinates
        try {
          const geo = await geocode(input.trim());
          if (geo) {
            state.location = { lat: geo.lat, lon: geo.lon };
            state.locationName = geo.name;
            await fetchWeather();
            return;
          }
        } catch (err) {
          console.error('Geocoding failed', err);
        }
        // If geocoding fails, just update the name and re-render
        state.locationName = input.trim();
        renderWeather();
      });
    }
  }

  // Geocode a location name using Open‑Meteo geocoding service
  async function geocode(name) {
    // Restrict geocoding to Canada by default to improve accuracy for common
    // Canadian locations. This helps avoid ambiguous results such as
    // selecting "Toronto, CA" in California when the user intends
    // "Toronto, ON" in Canada. If you wish to search globally, remove
    // `country_code=CA` from the query. You can also adapt this parameter
    // based on user preferences or locale in the future.
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&country_code=CA`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Geocoding API error');
    const data = await resp.json();
    if (data && data.results && data.results.length > 0) {
      const res = data.results[0];
      return {
        lat: res.latitude,
        lon: res.longitude,
        name: `${res.name}, ${res.country_code}`
      };
    }
    return null;
  }

  // Initialize the application
  async function init() {
    // Apply stored preferences (theme, units, location) if present
    const savedTheme = localStorage.getItem('dashboard-theme');
    if (savedTheme) {
      state.theme = savedTheme;
      applyTheme(savedTheme);
    }
    // Load any saved events for the current user from previous sessions
    loadEvents(state.currentUser);
    // Ensure the current events structure is saved back to localStorage. This
    // guarantees that stub events are persisted even if the user closes and
    // reopens the app, and provides a baseline for the next session.
    saveEvents(state.currentUser);
    // Fetch weather data
    await fetchWeather();
    // Render calendar and planner
    renderWeekdays();
    renderCalendar();
    renderPlanner();
    // Attach UI listeners
    attachListeners();
  }

  // Render day-of-week headers in the calendar
  function renderWeekdays() {
    const container = document.getElementById('calendar-weekdays');
    if (!container) return;
    container.innerHTML = '';
    WEEKDAYS.forEach(day => {
      const div = document.createElement('div');
      div.textContent = day;
      container.appendChild(div);
    });
  }

  // Apply theme by toggling class on body
  function applyTheme(theme) {
    const body = document.body;
    if (theme === 'light') {
      body.classList.add('light');
    } else {
      body.classList.remove('light');
    }
  }

  // Start the app once DOM is ready
  // When the DOM is ready, initialise authentication handling. The
  // dashboard itself is only initialised once a user has logged in.
  window.addEventListener('DOMContentLoaded', authInit);

  // --------------- Authentication and Settings -----------------

  // Track whether the dashboard has been initialised. This prevents
  // multiple calls to init() when switching users or logging in/out.
  let dashboardInitialized = false;

  /**
   * Update the letter shown in the user icon based on the current user.
   * If no user is logged in, the icon will display a generic letter.
   */
  function updateUserIcon() {
    const icon = document.getElementById('user-icon');
    if (!icon) return;
    const user = state.currentUser;
    icon.textContent = user ? user.charAt(0).toUpperCase() : 'U';
  }

  /**
   * Show a particular authentication form (login, signup or forgot) and
   * hide the others. Accepts the element id of the form to show.
   * @param {string} formId
   */
  function showAuthForm(formId) {
    const forms = document.querySelectorAll('.auth-form');
    forms.forEach(form => {
      form.classList.remove('active');
    });
    const form = document.getElementById(formId);
    if (form) form.classList.add('active');
  }

  /**
   * Initialise authentication handling on page load. If a user is
   * already logged in (as determined by localStorage), the dashboard
   * will be displayed immediately. Otherwise, the login screen will
   * appear. This function also sets up event handlers for the
   * authentication forms and the user menu.
   */
  function authInit() {
    const authContainer = document.getElementById('auth-container');
    const dashboardEl = document.getElementById('dashboard');
    const userMenu = document.getElementById('user-menu');
    const userIcon = document.getElementById('user-icon');
    const userDropdown = document.getElementById('user-dropdown');

    // Load saved users from localStorage
    const users = loadUsers();
    // Check if a user is already logged in via localStorage
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser && users[storedUser]) {
      state.currentUser = storedUser;
      // Hide auth screen and show dashboard
      authContainer.style.display = 'none';
      dashboardEl.style.display = 'grid';
      userMenu.style.display = 'block';
      updateUserIcon();
      // Only initialise the dashboard once
      if (!dashboardInitialized) {
        dashboardInitialized = true;
        // Load events for this user
        loadEvents(state.currentUser);
        // Persist stub events back to storage
        saveEvents(state.currentUser);
        // Initialise dashboard (weather, calendar, planner)
        init();
      }
    } else {
      // No user logged in: show auth screen and hide dashboard
      authContainer.style.display = 'flex';
      dashboardEl.style.display = 'none';
      userMenu.style.display = 'none';
      showAuthForm('login-form');
    }

    // Event handler to toggle the user menu drop‑down
    if (userIcon) {
      userIcon.addEventListener('click', () => {
        userMenu.classList.toggle('open');
      });
    }
    // Close dropdown when clicking outside the menu
    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target)) {
        userMenu.classList.remove('open');
      }
    });

    // Authentication form toggles
    const showSignup = document.getElementById('show-signup');
    const showLogin = document.getElementById('show-login');
    const showForgot = document.getElementById('show-forgot');
    const forgotBack = document.getElementById('forgot-back-login');
    if (showSignup) showSignup.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('signup-form'); });
    if (showLogin) showLogin.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('login-form'); });
    if (showForgot) showForgot.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('forgot-form'); });
    if (forgotBack) forgotBack.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('login-form'); });

    // Login submission handler
    const loginBtn = document.getElementById('login-submit');
    if (loginBtn) loginBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      if (!username || !password) {
        alert('Please enter a username and password.');
        return;
      }
      // If remote storage is enabled, validate credentials via the auth API.
      // If the API call fails (network/offline) or returns an error, fall back to
      // checking local users so that the app is still usable offline. This
      // fallback helps when running the dashboard locally without a backend.
      if (USE_REMOTE_STORAGE) {
        let remoteOK = false;
        try {
          const result = await remoteAuth('login', username, password);
          if (result && result.status === 'ok') {
            remoteOK = true;
          }
        } catch (err) {
          console.error('Remote login error:', err);
        }
        if (!remoteOK) {
          // Fallback to local user check. We avoid displaying remote JSON errors
          // directly to the user; instead we proceed with local auth. If the
          // remote API is not configured, this allows the app to work
          // offline or without a backend. Only alert if credentials are
          // invalid locally as well.
          if (!users[username] || users[username].password !== password) {
            alert('Invalid username or password.');
            return;
          }
        }
      } else {
        // Local only: verify credentials
        if (!users[username] || users[username].password !== password) {
          alert('Invalid username or password.');
          return;
        }
      }
      // Success: store current user, hide auth screen and show dashboard
      localStorage.setItem('currentUser', username);
      state.currentUser = username;
      authContainer.style.display = 'none';
      dashboardEl.style.display = 'grid';
      userMenu.style.display = 'block';
      updateUserIcon();
      // Initialise dashboard if not done yet
      if (!dashboardInitialized) {
        dashboardInitialized = true;
        loadEvents(state.currentUser);
        saveEvents(state.currentUser);
        init();
      } else {
        // Already initialised: reload user events and refresh views
        Object.keys(STUB_EVENTS).forEach(k => delete STUB_EVENTS[k]);
        loadEvents(state.currentUser);
        saveEvents(state.currentUser);
        renderCalendar();
        renderPlanner();
      }
    });

    // Signup submission handler
    const signupBtn = document.getElementById('signup-submit');
    if (signupBtn) signupBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const username = document.getElementById('signup-username').value.trim();
      const pass = document.getElementById('signup-password').value;
      const confirm = document.getElementById('signup-confirm').value;
      if (!username || !pass || !confirm) {
        alert('Please fill out all fields.');
        return;
      }
      if (pass !== confirm) {
        alert('Passwords do not match.');
        return;
      }
      // If remote, create user via API. If the API fails (network/offline), fall back
      // to local storage. This ensures the signup still works when the backend
      // isn't reachable.
      if (USE_REMOTE_STORAGE) {
        let remoteOK = false;
        try {
          const result = await remoteAuth('signup', username, pass);
          if (result && result.status === 'ok') {
            remoteOK = true;
          }
        } catch (err) {
          console.error('Remote signup error:', err);
        }
        if (!remoteOK) {
          // local fallback: ensure user does not exist
          if (users[username]) {
            alert('User already exists. Please choose another username.');
            return;
          }
          users[username] = { password: pass };
          saveUsers(users);
        }
      } else {
        // local only: ensure user does not exist
        if (users[username]) {
          alert('User already exists. Please choose another username.');
          return;
        }
        users[username] = { password: pass };
        saveUsers(users);
      }
      // Set as current user
      localStorage.setItem('currentUser', username);
      state.currentUser = username;
      // Clear event store for new user
      Object.keys(STUB_EVENTS).forEach(k => delete STUB_EVENTS[k]);
      saveEvents(state.currentUser);
      // Hide auth screen and show dashboard
      authContainer.style.display = 'none';
      dashboardEl.style.display = 'grid';
      userMenu.style.display = 'block';
      updateUserIcon();
      // Initialise dashboard if not done
      if (!dashboardInitialized) {
        dashboardInitialized = true;
        init();
      } else {
        renderCalendar();
        renderPlanner();
      }
    });

    // Forgot password submission handler
    const forgotBtn = document.getElementById('forgot-submit');
    if (forgotBtn) forgotBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const username = document.getElementById('forgot-username').value.trim();
      const newPass = document.getElementById('forgot-password').value;
      const confirmPass = document.getElementById('forgot-confirm').value;
      if (!username || !newPass || !confirmPass) {
        alert('Please fill out all fields.');
        return;
      }
      if (newPass !== confirmPass) {
        alert('Passwords do not match.');
        return;
      }
      if (USE_REMOTE_STORAGE) {
        // When using remote storage, call the auth API to change the password. We omit
        // the current password since the user cannot log in; remote API should allow
        // resetting with just the username and new password.
        remoteAuth('changePassword', username, '', newPass).then((result) => {
          if (result && result.status === 'ok') {
            alert('Password reset successful. You can now log in.');
            showAuthForm('login-form');
          } else {
            alert(result && result.error ? result.error : 'Password reset failed.');
          }
        });
        return;
      }
      if (!users[username]) {
        alert('User does not exist.');
        return;
      }
      // Update password in local storage
      users[username].password = newPass;
      saveUsers(users);
      alert('Password reset successful. You can now log in.');
      showAuthForm('login-form');
    });

    // Settings menu actions
    const themeBtn = document.getElementById('settings-theme');
    const passwordBtn = document.getElementById('settings-password');
    const logoutBtn = document.getElementById('settings-logout');
    if (themeBtn) themeBtn.addEventListener('click', () => {
      // Toggle theme between dark and light; ignore auto for now
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(state.theme);
      localStorage.setItem('dashboard-theme', state.theme);
      // Close menu
      userMenu.classList.remove('open');
    });
    if (passwordBtn) passwordBtn.addEventListener('click', async () => {
      // Prompt for new password
      const newPass = prompt('Enter new password:');
      if (!newPass) return;
      const confirm = prompt('Confirm new password:');
      if (newPass !== confirm) {
        alert('Passwords do not match.');
        return;
      }
      const user = state.currentUser;
      if (!user) {
        alert('User not found.');
        return;
      }
      if (USE_REMOTE_STORAGE) {
        // Ask for current password to authenticate change
        const currentPass = prompt('Enter current password:');
        const result = await remoteAuth('changePassword', user, currentPass, newPass);
        if (result && result.status === 'ok') {
          alert('Password updated successfully.');
        } else {
          alert(result && result.error ? result.error : 'Password update failed.');
          return;
        }
      } else {
        const usersAll = loadUsers();
        if (!usersAll[user]) {
          alert('User not found.');
          return;
        }
        usersAll[user].password = newPass;
        saveUsers(usersAll);
        alert('Password updated successfully.');
      }
      userMenu.classList.remove('open');
    });
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
      // Remove current user and return to login screen
      localStorage.removeItem('currentUser');
      state.currentUser = null;
      // Hide user menu
      userMenu.classList.remove('open');
      userMenu.style.display = 'none';
      // Clear events and stub events for security
      Object.keys(STUB_EVENTS).forEach(k => delete STUB_EVENTS[k]);
      // Show auth screen and hide dashboard
      authContainer.style.display = 'flex';
      dashboardEl.style.display = 'none';
      // Optionally revert to login form
      showAuthForm('login-form');
    });
  }
})();