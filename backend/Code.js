// entry point for both web app and API requests
function doGet(e) {
  // if an "action" parameter is present we treat the request as an API call
  if (e && e.parameter && e.parameter.action) {
    return handleApiRequest(e);
  }

  // otherwise serve the normal HTML interface (used when you deploy the script as a web app)
  // Apps Script file names are case‑sensitive; the HTML file in this repo is "index.html"
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Workout Logger')
    // Added maximum-scale=1 and user-scalable=0 to prevent the disorienting iOS input zoom shift
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// support POST requests from external clients (your GitHub Pages site will likely use POST when sending JSON bodies)
function doPost(e) {
  return handleApiRequest(e);
}

// handle preflight OPTIONS for CORS
function doOptions(e) {
  // returning an empty response with the necessary headers
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// general dispatcher for API actions
function handleApiRequest(e) {
  var action;
  var payload = {};

  // GET parameters take precedence for simple requests
  if (e.parameter && e.parameter.action) {
    action = e.parameter.action;
    payload = e.parameter;
  }

  // if there's a JSON body, parse it (useful for POST)
  if (e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      if (body.action) action = body.action;
      // merge body properties into payload
      for (var k in body) {
        if (body.hasOwnProperty(k)) payload[k] = body[k];
      }
    } catch (err) {
      // ignore parse errors; payload may already be filled from parameters
    }
  }

  var result;
  switch (action) {
    case 'getTodayWorkout':
      result = getTodayWorkout(payload.date || payload.dateStr);
      break;
    case 'saveWorkoutData':
      result = saveWorkoutData(payload.workoutData, payload.dateStr, payload.bodyweight);
      break;
    case 'getHistoricalExercises':
      result = getHistoricalExercises();
      break;
    case 'getLastWeekRoutine':
      result = getLastWeekRoutine(payload.date || payload.dateStr);
      break;
    case 'getExerciseHistory':
      result = getExerciseHistory(payload.exerciseName);
      break;
    case 'getPrefetchHistory':
      result = getPrefetchHistory();
      break;
    default:
      result = {error: 'Unknown action: ' + action};
  }

  var output = ContentService.createTextOutput(JSON.stringify(result));
  output.setMimeType(ContentService.MimeType.JSON);
  output.setHeader('Access-Control-Allow-Origin', '*');
  return output;
}
// Hello from VS Code
function saveWorkoutData(workoutData, dateStr, bodyweight) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  const dateParts = dateStr.split('-');
  const timestamp = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
  const dateString = timestamp.toLocaleDateString();
  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // If the user ONLY logs bodyweight on a rest day
  if (workoutData.length === 0 && bodyweight !== "") {
    sheet.appendRow([
      dateString, timeString, "Daily Bodyweight", "", "", "", "saved", "bw-" + Date.now(), "", bodyweight
    ]);
    return "Saved daily bodyweight!";
  }

  const lastRow = sheet.getLastRow();
  const searchRows = Math.min(lastRow, 300);
  const startRow = Math.max(1, lastRow - searchRows + 1);
  
  let data = [];
  if (lastRow > 0) {
    data = sheet.getRange(startRow, 1, searchRows, 10).getValues();
  }
  
  const idColumnIndex = 7; 
  let setsSaved = 0;
  let setsUpdated = 0;

  workoutData.forEach(function(item) {
    const exerciseName = item.exercise;
    const notes = item.notes; 
    
    item.sets.forEach(function(set) {
      const setNumber = set.setNumber; 
      const weight = set.weight;
      const reps = set.reps;
      const setId = set.setId; 
      
      let rowIndexToUpdate = -1;
      
      for (let i = data.length - 1; i >= 0; i--) {
        if (!data[i][0]) continue; 
        if (data[i][idColumnIndex] === setId) {
          rowIndexToUpdate = startRow + i; 
          break;
        }
      }

      if (rowIndexToUpdate !== -1) {
        sheet.getRange(rowIndexToUpdate, 2).setValue(timeString);
        sheet.getRange(rowIndexToUpdate, 5).setValue(weight);
        sheet.getRange(rowIndexToUpdate, 6).setValue(reps);
        sheet.getRange(rowIndexToUpdate, 9).setValue(notes); 
        sheet.getRange(rowIndexToUpdate, 10).setValue(bodyweight); 
        setsUpdated++;
      } else {
        sheet.appendRow([
          dateString, timeString, exerciseName, setNumber, weight, reps, "saved", setId, notes, bodyweight
        ]);
        setsSaved++;
      }
    });
  });
  
  return `Saved ${setsSaved} new sets and updated ${setsUpdated} existing sets!`;
}

function getTodayWorkout(dateStr) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { exercises: [], bodyweight: "" }; 
  
  const numRows = Math.min(lastRow - 1, 300);
  const startRow = lastRow - numRows + 1;
  const data = sheet.getRange(startRow, 1, numRows, 10).getValues();
  
  const dateParts = dateStr.split('-');
  const tYear = parseInt(dateParts[0], 10);
  const tMonth = parseInt(dateParts[1], 10) - 1;
  const tDate = parseInt(dateParts[2], 10);
  
  let exercises = {};
  let dailyBodyweight = "";
  
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    let rowDate = new Date(data[i][0]);
    
    if (!isNaN(rowDate) && rowDate.getFullYear() === tYear && rowDate.getMonth() === tMonth && rowDate.getDate() === tDate) {
      if (data[i][9]) dailyBodyweight = data[i][9];
      let exName = data[i][2];
      if (exName === "Daily Bodyweight") continue;

      let rowNotes = data[i][8] || "";
      if (!exercises[exName]) {
        exercises[exName] = { id: i, name: exName, notes: rowNotes, sets: [] };
      }
      
      exercises[exName].sets.push({
        setNumber: data[i][3], weight: data[i][4], reps: data[i][5], setId: data[i][7]
      });
    }
  }
  return { exercises: Object.values(exercises), bodyweight: dailyBodyweight };
}

function getHistoricalExercises() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; 
  const data = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  let uniqueExercises = [];
  data.flat().forEach(ex => {
    if (ex && ex !== "Daily Bodyweight" && !uniqueExercises.includes(ex)) {
      uniqueExercises.push(ex);
    }
  });
  return uniqueExercises.sort();
}

function getLastWeekRoutine(dateStr) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  const dateParts = dateStr.split('-');
  let targetDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
  targetDate.setDate(targetDate.getDate() - 7);
  
  const tYear = targetDate.getFullYear();
  const tMonth = targetDate.getMonth();
  const tDate = targetDate.getDate();
  
  let exercises = [];
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    let rowDate = new Date(data[i][0]);
    if (!isNaN(rowDate) && rowDate.getFullYear() === tYear && rowDate.getMonth() === tMonth && rowDate.getDate() === tDate) {
      let exName = data[i][2];
      if (exName && exName !== "Daily Bodyweight" && !exercises.includes(exName)) {
        exercises.push(exName);
      }
    }
  }
  return exercises;
}

function getExerciseHistory(exerciseName) {
  if (!exerciseName || exerciseName === "Daily Bodyweight") return [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  const todayString = new Date().toLocaleDateString();
  let sessions = [];
  for (let i = data.length - 1; i >= 1; i--) {
    if (!data[i][0]) continue;
    let rowDate = new Date(data[i][0]).toLocaleDateString();
    let name = data[i][2];
    
    if (name === exerciseName && rowDate !== todayString) {
      let sessionObj = sessions.find(s => s.date === rowDate);
      if (!sessionObj) {
        sessionObj = { date: rowDate, sets: [] };
        sessions.push(sessionObj);
      }
      sessionObj.sets.push({
        setNumber: data[i][3], weight: data[i][4], reps: data[i][5], notes: data[i][8] || ""
      });
    }
  }
  sessions.forEach(s => s.sets.reverse());
  return sessions;
}

function getPrefetchHistory() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const numRows = Math.min(lastRow - 1, 1500);
  const startRow = lastRow - numRows + 1;
  const data = sheet.getRange(startRow, 1, numRows, 9).getValues();

  const todayString = new Date().toLocaleDateString();
  let historyDict = {};

  for (let i = data.length - 1; i >= 0; i--) {
    if (!data[i][0]) continue;
    let rowDate = new Date(data[i][0]).toLocaleDateString();
    let name = data[i][2];

    if (!name || name === "Daily Bodyweight" || rowDate === todayString) continue;
    if (!historyDict[name]) historyDict[name] = [];

    let sessionObj = historyDict[name].find(s => s.date === rowDate);
    if (!sessionObj) {
      sessionObj = { date: rowDate, sets: [] };
      historyDict[name].push(sessionObj);
    }

    sessionObj.sets.push({
      setNumber: data[i][3], weight: data[i][4], reps: data[i][5], notes: data[i][8] || ""
    });
  }

  for (let ex in historyDict) {
    historyDict[ex].forEach(session => session.sets.reverse());
  }

  return historyDict;
}