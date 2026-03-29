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

async function loadGuildSettings(guildId) {
    setStatus("Loading…", null);
    const data = await fetchJson(`/api/guilds/${guildId}/settings`);
    descriptions = data.descriptions || {};
    prefixInput.value = data.settings.prefix || "";
    renderCommands(data.settings.commands);
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
                commands
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
