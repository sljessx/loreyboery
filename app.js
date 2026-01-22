// --- Configuration ---
const CLIENT_ID = '2d44be25ffc847c4ba98bbeb9d352535';
const CLIENT_SECRET = 'N7ZykG6y4S2cih4Kai4gNUpAY7a6ZfWu';
const REDIRECT_URI = 'https://sljessx.github.io/loreyboery/'; 

const LOREMASTER_ACHIEVEMENT_ID = 7520; 

// --- ELEMENTS ---
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const regionSelect = document.getElementById('region-select');
const loginSection = document.getElementById('login-section');
const resultsSection = document.getElementById('results-section');
const expansionList = document.getElementById('expansion-list');

// --- DEBUG LOG ---
const debugDiv = document.createElement('div');
debugDiv.style.background = '#222';
debugDiv.style.color = '#0f0';
debugDiv.style.padding = '10px';
debugDiv.style.marginTop = '20px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.whiteSpace = 'pre-wrap';
document.querySelector('main').appendChild(debugDiv);

function log(msg) {
    console.log(msg);
    debugDiv.innerHTML += msg + '\n';
}

function generateRandomString(length) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
    }
    return result;
}

// --- STEP 1: LOGIN ---
async function initiateLogin() {
    const region = regionSelect.value; 
    sessionStorage.setItem('selected_region', region);
    
    log(`Initializing Login for Region: ${region.toUpperCase()}`);

    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    const authUrl = new URL('https://oauth.battle.net/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'wow.profile');
    authUrl.searchParams.append('state', state);

    window.location.href = authUrl.toString();
}

// --- STEP 2: TOKEN EXCHANGE ---
async function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    const savedRegion = sessionStorage.getItem('selected_region') || 'us';
    regionSelect.value = savedRegion;

    if (code && state) {
        log(`Callback received. Exchanging code...`);
        loginSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');

        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            log("SECURITY ERROR: State mismatch.");
            return;
        }

        try {
            const tokenUrl = 'https://oauth.battle.net/token';
            const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 
                    'Authorization': `Basic ${basicAuth}`,
                    'Content-Type': 'application/x-www-form-urlencoded' 
                },
                body: new URLSearchParams({
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code',
                    code: code
                })
            });

            if (!tokenResponse.ok) {
                const text = await tokenResponse.text();
                log(`TOKEN ERROR: ${tokenResponse.status}`);
                log(`Details: ${text}`);
                return;
            }

            const tokenData = await tokenResponse.json();
            log("Token acquired! Fetching profile data...");
            sessionStorage.setItem('access_token', tokenData.access_token);
            
            fetchAchievementData();
        } catch (error) {
            log(`CRITICAL ERROR: ${error.message}`);
        }
    } else {
        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
            log("Session found. Loading data...");
            loginSection.classList.add('hidden');
            resultsSection.classList.remove('hidden');
            fetchAchievementData();
        } else {
            log("Ready. Select region and log in.");
        }
    }
}

// --- STEP 3: DATA FETCH (With Fallback) ---
async function fetchAchievementData() {
    const accessToken = sessionStorage.getItem('access_token');
    const region = sessionStorage.getItem('selected_region') || 'us'; 
    const apiBaseUrl = `https://${region}.api.blizzard.com`;
    const namespace = `profile-${region}`;

    log(`Attempting Plan A: Account Profile...`);

    try {
        // PLAN A: Direct Account Fetch
        let response = await fetch(`${apiBaseUrl}/profile/user/wow/achievements?namespace=${namespace}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.ok) {
            log("Plan A Success: Account data found.");
            const data = await response.json();
            processLoremasterDeepDive(data, apiBaseUrl, namespace, accessToken);
            return;
        }

        if (response.status === 404) {
            log("Plan A Failed (404). Account Profile not found.");
            log("Attempting Plan B: Fetching Character List...");
            
            // PLAN B: Fetch Account Summary -> Get Main Character -> Get Their Achievements
            await fetchCharacterFallback(apiBaseUrl, namespace, accessToken);
            return;
        }

        // Handle other errors
        log(`API ERROR: ${response.status}`);

    } catch (error) {
        log(`FETCH ERROR: ${error.message}`);
    }
}

async function fetchCharacterFallback(apiBaseUrl, namespace, accessToken) {
    try {
        // 1. Get List of Characters
        const accountResponse = await fetch(`${apiBaseUrl}/profile/user/wow?namespace=${namespace}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!accountResponse.ok) {
            log(`Plan B Failed: Could not load character list (Error ${accountResponse.status}).`);
            log("Do you have any characters on this Region?");
            return;
        }

        const accountData = await accountResponse.json();
        
        if (!accountData.wow_accounts || accountData.wow_accounts.length === 0) {
            log("Plan B Failed: No WoW accounts found.");
            return;
        }

        // Flatten the list of all characters across all licenses
        let allChars = [];
        accountData.wow_accounts.forEach(acc => {
            if (acc.characters) allChars = allChars.concat(acc.characters);
        });

        if (allChars.length === 0) {
            log("Plan B Failed: No characters found.");
            return;
        }

        // 2. Pick the 'Best' Character (highest level)
        // Sort by level descending
        allChars.sort((a, b) => b.level - a.level);
        const mainChar = allChars[0];

        log(`Plan B: Using Main Character: ${mainChar.name} (Level ${mainChar.level})`);
        
        // 3. Fetch Achievements for this Character
        // Character HREF usually looks like: .../character/realm-slug/char-name
        // We construct the Achievement URL from the character's HREF
        const charAchievUrl = `${mainChar.key.href}/achievements?namespace=${namespace}`;
        
        const charResponse = await fetch(charAchievUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!charResponse.ok) {
            log(`Plan B Failed: Could not load character achievements (Error ${charResponse.status}).`);
            return;
        }

        const charData = await charResponse.json();
        log("Plan B Success: Character data loaded.");
        
        // Process this data (Structure is nearly identical)
        processLoremasterDeepDive(charData, apiBaseUrl, namespace, accessToken);

    } catch (error) {
        log(`FALLBACK ERROR: ${error.message}`);
    }
}

function processLoremasterDeepDive(data, apiBaseUrl, namespace, accessToken) {
    if (!data.achievements) { log("No achievement data found."); return; }
    
    const loremaster = data.achievements.find(a => a.id === LOREMASTER_ACHIEVEMENT_ID);
    if (!loremaster) {
        log("Loremaster Achievement (ID 7520) not found in list.");
        return;
    }

    log("Rendering Loremaster Data...");
    const overallStatus = document.getElementById('overall-status');
    const overallProgressBar = document.getElementById('overall-progress-bar');
    
    // Safety check for criteria
    if (!loremaster.criteria || !loremaster.criteria.child_criteria) {
        // If completed, criteria might be empty in some API responses?
        if (loremaster.is_completed) {
            overallStatus.textContent = "Status: Completed!";
            overallProgressBar.style.width = '100%';
            expansionList.innerHTML = '<li class="achievement-item completed">You are The Loremaster!</li>';
            return;
        }
        log("Error: Achievement criteria data missing.");
        return;
    }

    const total = loremaster.criteria.child_criteria.length;
    const completed = loremaster.criteria.child_criteria.filter(c => c.is_completed).length;
    const percent = Math.round((completed / total) * 100);
    
    overallStatus.textContent = `Progress: ${percent}%`;
    overallProgressBar.style.width = `${percent}%`;

    // Pass the full dataset (allData) to the render function
    renderExpansions(loremaster.criteria.child_criteria, data.achievements);
}

function renderExpansions(expansionCriteria, allAchievements) {
    expansionList.innerHTML = '';
    
    expansionCriteria.forEach(expCrit => {
        const expId = expCrit.achievement.id; 
        const expData = allAchievements.find(a => a.id === expId);
        
        const expLi = document.createElement('li');
        expLi.className = `achievement-item ${expCrit.is_completed ? 'completed' : 'incomplete'}`;
        expLi.style.flexDirection = 'column';
        expLi.style.alignItems = 'flex-start';

        expLi.innerHTML = `<strong>Achievement ${expId}</strong>: ${expCrit.is_completed ? 'Done' : 'In Progress'}`;

        if (!expCrit.is_completed && expData && expData.criteria) {
            const zoneList = document.createElement('ul');
            zoneList.style.fontSize = '0.9em';
            zoneList.style.marginTop = '5px';
            
            const zoneCriteria = expData.criteria.child_criteria || [expData.criteria];

            zoneCriteria.forEach(zoneCrit => {
                if (zoneCrit.is_completed) return;
                
                const zoneId = zoneCrit.achievement ? zoneCrit.achievement.id : null;
                if(!zoneId) return;

                const zoneData = allAchievements.find(a => a.id === zoneId);
                let detailText = "Incomplete";

                if (zoneData) {
                    if (zoneData.criteria && zoneData.criteria.amount !== undefined) {
                        detailText = `${zoneData.criteria.amount} / ${zoneData.criteria.max} Quests`;
                    } else if (zoneData.criteria && zoneData.criteria.child_criteria) {
                         const missing = zoneData.criteria.child_criteria
                            .filter(c => !c.is_completed)
                            .map(c => c.description).join(', ');
                         detailText = missing || "Chapters missing";
                    }
                }
                
                const zLi = document.createElement('li');
                zLi.innerHTML = `Zone ${zoneId}: ${detailText}`;
                zoneList.appendChild(zLi);
            });
            expLi.appendChild(zoneList);
        }
        expansionList.appendChild(expLi);
    });
}

loginBtn.addEventListener('click', initiateLogin);
if(logoutBtn) logoutBtn.addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = window.location.pathname;
});
regionSelect.addEventListener('change', () => sessionStorage.setItem('selected_region', regionSelect.value));

handleCallback();
