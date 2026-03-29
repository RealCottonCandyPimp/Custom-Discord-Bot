const guildSelect = document.getElementById("guild-select");
const prefixInput = document.getElementById("prefix-input");
const commandsList = document.getElementById("commands-list");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userLabel = document.getElementById("user-label");
const appPanel = document.getElementById("app-panel");
const gate = document.getElementById("gate");
const xpEnabled = document.getElementById("xp-enabled");
const xpPerMessage = document.getElementById("xp-per-message");
const xpPerLevel = document.getElementById("xp-per-level");
const xpDailyCap = document.getElementById("xp-daily-cap");
const xpLevelRolesList = document.getElementById("xp-level-roles-list");
const xpLevelRolesAdd = document.getElementById("xp-level-roles-add");

let currentGuildId = null;
let descriptions = {};

function setStatus(text, kind) {
    saveStatus.textContent = text || "";
    saveStatus.classList.remove("ok", "err");
    if (kind) {
        saveStatus.classList.add(kind);
    }
}

async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || res.statusText || "Request failed");
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

function renderCommands(commands) {
    commandsList.innerHTML = "";
    const names = Object.keys(commands || {}).sort();
    for (const name of names) {
        const row = document.createElement("div");
        row.className = "cmd-row";
        const meta = document.createElement("div");
        meta.className = "meta";
        const title = document.createElement("div");
        title.className = "cmd-name";
        title.textContent = name;
        const desc = document.createElement("div");
        desc.className = "cmd-desc";
        desc.textContent = descriptions[name] || "";
        meta.appendChild(title);
        meta.appendChild(desc);

        const toggle = document.createElement("label");
        toggle.className = "toggle";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.command = name;
        input.checked = Boolean(commands[name]);
        toggle.appendChild(input);
        toggle.appendChild(document.createTextNode("Enabled"));

        row.appendChild(meta);
        row.appendChild(toggle);
        commandsList.appendChild(row);
    }
}

function addLevelRoleRow(entry = {}) {
    const row = document.createElement("div");
    row.className = "level-role-row";

    const levelWrap = document.createElement("label");
    levelWrap.className = "field compact";
    const levelSpan = document.createElement("span");
    levelSpan.textContent = "Level";
    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.min = "2";
    levelInput.max = "1000000";
    levelInput.step = "1";
    levelInput.dataset.field = "level";
    levelInput.value = entry.level != null && entry.level !== "" ? String(entry.level) : "";
    levelWrap.appendChild(levelSpan);
    levelWrap.appendChild(levelInput);

    const roleWrap = document.createElement("label");
    roleWrap.className = "field compact";
    const roleSpan = document.createElement("span");
    roleSpan.textContent = "Role ID";
    const roleInput = document.createElement("input");
    roleInput.type = "text";
    roleInput.autocomplete = "off";
    roleInput.placeholder = "e.g. 123456789012345678";
    roleInput.dataset.field = "roleId";
    roleInput.value = entry.roleId != null ? String(entry.roleId) : "";
    roleWrap.appendChild(roleSpan);
    roleWrap.appendChild(roleInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn icon-only";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
        row.remove();
    });

    row.appendChild(levelWrap);
    row.appendChild(roleWrap);
    row.appendChild(removeBtn);
    xpLevelRolesList.appendChild(row);
}

function renderLevelRoles(levelRoles) {
    xpLevelRolesList.innerHTML = "";
    const list = Array.isArray(levelRoles) ? levelRoles : [];
    for (const r of list) {
        addLevelRoleRow({ level: r.level, roleId: r.roleId });
    }
}

function collectLevelRoles() {
    const out = [];
    for (const row of xpLevelRolesList.querySelectorAll(".level-role-row")) {
        const levelInput = row.querySelector('input[data-field="level"]');
        const roleInput = row.querySelector('input[data-field="roleId"]');
        const levelStr = (levelInput?.value ?? "").trim();
        const roleId = (roleInput?.value ?? "").trim();
        if (levelStr === "" && roleId === "") {
            continue;
        }
        out.push({ level: Number(levelStr), roleId });
    }
    return out;
}

xpLevelRolesAdd.addEventListener("click", () => {
    addLevelRoleRow({});
});

async function loadGuildSettings(guildId) {
    setStatus("Loading…", null);
    const data = await fetchJson(`/api/guilds/${guildId}/settings`);
    descriptions = data.descriptions || {};
    prefixInput.value = data.settings.prefix || "";
    renderCommands(data.settings.commands);
    const x = data.settings.xp || {};
    xpEnabled.checked = Boolean(x.enabled);
    xpPerMessage.value = String(x.perMessage ?? 15);
    xpPerLevel.value = String(x.perLevel ?? 100);
    xpDailyCap.value = String(x.dailyCap ?? 500);
    renderLevelRoles(x.levelRoles);
    setStatus("", null);
}

async function refreshSessionUi() {
    try {
        const me = await fetchJson("/api/me");
        const label = me.user.global_name || me.user.username;
        userLabel.textContent = label;
        loginBtn.hidden = true;
        logoutBtn.hidden = false;
        gate.hidden = true;
        appPanel.hidden = false;

        const { guilds } = await fetchJson("/api/guilds");
        guildSelect.innerHTML = "";
        if (guilds.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No eligible servers";
            guildSelect.appendChild(opt);
            guildSelect.disabled = true;
            setStatus("No servers found where you can manage the bot.", null);
            return;
        }
        guildSelect.disabled = false;
        for (const g of guilds) {
            const opt = document.createElement("option");
            opt.value = g.id;
            opt.textContent = g.name;
            guildSelect.appendChild(opt);
        }
        currentGuildId = guilds[0].id;
        guildSelect.value = currentGuildId;
        await loadGuildSettings(currentGuildId);
    } catch (err) {
        if (err.status === 401) {
            userLabel.textContent = "";
            loginBtn.hidden = false;
            logoutBtn.hidden = true;
            gate.hidden = false;
            appPanel.hidden = true;
        } else {
            console.error(err);
            setStatus(err.message || "Something went wrong", "err");
        }
    }
}

guildSelect.addEventListener("change", async () => {
    const id = guildSelect.value;
    if (!id) {
        return;
    }
    currentGuildId = id;
    await loadGuildSettings(id);
});

saveBtn.addEventListener("click", async () => {
    if (!currentGuildId) {
        return;
    }
    const commands = {};
    for (const box of commandsList.querySelectorAll('input[type="checkbox"][data-command]')) {
        commands[box.dataset.command] = box.checked;
    }
    setStatus("Saving…", null);
    try {
        await fetchJson(`/api/guilds/${currentGuildId}/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prefix: prefixInput.value,
                commands,
                xp: {
                    enabled: xpEnabled.checked,
                    perMessage: Number(xpPerMessage.value),
                    perLevel: Number(xpPerLevel.value),
                    dailyCap: Number(xpDailyCap.value),
                    levelRoles: collectLevelRoles()
                }
            })
        });
        setStatus("Saved.", "ok");
    } catch (err) {
        setStatus(err.message || "Save failed", "err");
    }
});

logoutBtn.addEventListener("click", async () => {
    try {
        await fetchJson("/api/logout", { method: "POST" });
    } catch {
        // ignore
    }
    window.location.reload();
});

refreshSessionUi();
