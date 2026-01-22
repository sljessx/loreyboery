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
            log("Token acquired! Finding your main character...");
            sessionStorage.setItem('access_token', tokenData.access_token);
            
            // Go straight to the "Find Main Character" logic
            findMainCharacter();
        } catch (error) {
            log(`CRITICAL ERROR: ${error.message}`);
        }
    } else {
        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
            log("Session found. Loading data...");
            loginSection.classList.add('hidden');
            resultsSection.classList.remove('hidden');
            findMainCharacter();
        } else {
            log("Ready. Select region and log in.");
        }
    }
}

// --- STEP 3: FIND CHARACTER & FETCH ACHIEVEMENTS ---
async function findMainCharacter() {
    const accessToken = sessionStorage.getItem('access_token');
    const region = sessionStorage.getItem('selected_region') || 'us'; 
    const apiBaseUrl = `https://${region}.api.blizzard.com`;
    const namespace = `profile-${region}`;

    try {
        // 1. Get the Account Summary (List of Characters)
        const accountResponse = await fetch(`${apiBaseUrl}/profile/user/wow?namespace=${namespace}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!accountResponse.ok) {
            log(`ACCOUNT ERROR: ${accountResponse.status}`);
            log("Could not load account summary.");
            return;
        }

        const accountData = await accountResponse.json();
        
        if (!accountData.wow_accounts || accountData.wow_accounts.length === 0) {
            log("Error: No WoW accounts found.");
            return;
        }

        // 2. Flatten the list to find all characters
        let allChars = [];
        accountData.wow_accounts.forEach(acc => {
            if (acc.characters) allChars = allChars.concat(acc.characters);
        });

        if (allChars.length === 0) {
            log("Error: No characters found on this account.");
            return;
        }

        // 3. Sort by Level (High to Low) to find "Main"
        allChars.sort((a, b) => b.level - a.level);
        const mainChar = allChars[0];

        log(`Found Main Character: ${mainChar.name} (Level ${mainChar.level})`);
        log(`Realm: ${mainChar.realm.name}`);

        // 4. Construct the URL manually (The "href" fix)
        // We use lowercase name and slugified realm as per API docs
        const charName = mainChar.name.toLowerCase();
        const realmSlug = mainChar.realm.slug;
        
        const achievUrl = `${apiBaseUrl}/profile/wow/character/${realmSlug}/${charName}/achievements?namespace=${namespace}`;

        log(`Fetching Achievements...`);
        
        const achievResponse = await fetch(achievUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!achievResponse.ok) {
            log(`ACHIEVEMENT ERROR: ${achievResponse.status}`);
            return;
        }

        const achievData = await achievResponse.json();
        processLoremasterDeepDive(achievData, achievData.achievements);

    } catch (error) {
        log(`LOGIC ERROR: ${error.message}`);
    }
}

function processLoremasterDeepDive(data, allAchievements) {
    const loremaster = allAchievements.find(a => a.id === LOREMASTER_ACHIEVEMENT_ID);

    log("Rendering Loremaster Data...");
    const overallStatus = document.getElementById('overall-status');
    const overallProgressBar = document.getElementById('overall-progress-bar');

    if (!loremaster) {
        log("Loremaster data not found on this character.");
        return;
    }
    
    // Safety check for criteria
    if (!loremaster.criteria || !loremaster.criteria.child_criteria) {
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

    renderExpansions(loremaster.criteria.child_criteria, allAchievements);
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

        // NOTE: We display ID because names require a separate Static Data call.
        expLi.innerHTML = `<strong>Achievement ${expId}</strong>: ${expCrit.is_completed ? 'Done' : 'In Progress'}`;

        if (!expCrit.is_completed && expData && expData.criteria) {
            const zoneList = document.createElement('ul');
            zoneList.style.fontSize = '0.9em';
            zoneList.style.marginTop = '5px';
            
            // Handle different criteria structures
            let zoneCriteria = [];
            if (expData.criteria.child_criteria) {
                zoneCriteria = expData.criteria.child_criteria;
            } else {
                zoneCriteria = [expData.criteria];
            }

            zoneCriteria.forEach(zoneCrit => {
                if (zoneCrit.is_completed) return;
                
                // Try to find a meaningful name or ID
                const zoneId = zoneCrit.achievement ? zoneCrit.achievement.id : null;
                const description = zoneCrit.description || "Unknown Task";

                let detailText = "Incomplete";

                if (zoneId) {
                    const zoneData = allAchievements.find(a => a.id === zoneId);
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
                } else {
                     detailText = description; 
                }
                
                const zLi = document.createElement('li');
                zLi.innerHTML = zoneId ? `Zone ${zoneId}: ${detailText}` : `Task: ${detailText}`;
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
