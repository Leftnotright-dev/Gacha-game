# app.py
import json, os, random, time, uuid
from flask import Flask, request, jsonify, render_template

app = Flask(__name__, static_folder="static", template_folder="templates")

DB_PATH = os.path.join(os.path.dirname(__file__), "swca_db.json")

# ----------------------- Data helpers -----------------------
def _now():
    return int(time.time())

def load_db():
    """Load DB safely; tolerate empty/corrupt files."""
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    data = {}
        except Exception:
            data = {}
    else:
        data = {}
    # ensure structure
    if "users" not in data or not isinstance(data.get("users"), dict):
        data["users"] = {}
    return data

def save_db(db):
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)
    os.replace(tmp, DB_PATH)

DB = load_db()

def ensure_users_key():
    """Guarantee DB has 'users' dict; save if we add it."""
    global DB
    if "users" not in DB or not isinstance(DB.get("users"), dict):
        DB["users"] = {}
        save_db(DB)

def get_user(username):
    """Create-on-demand user record with safe 'users' access."""
    global DB
    ensure_users_key()
    username = (username or "").strip()
    if not username:
        return None
    if username not in DB["users"]:
        DB["users"][username] = {
            "gems": 2000,
            "coins": 500,
            "max_cleared": 0,
            "backpack": [],
            "team": [],
            "shards": {},
            "history": [],
            "index": []
        }
        save_db(DB)
    return DB["users"][username]

# ----------------------- Catalog & rates -----------------------
ORDER = ["Common", "Rare", "Ultra", "Mythical", "Secret", "Celestial"]

CATALOG = {
    "Common":   ["Yumi", "Fatima", "Jlita", "Minii", "Nva","Hennessy"],
    "Rare":     ["Jordan", "Goonie", "Wes", "Shelly"],
    "Ultra":    ["Snorlax", "Fatima Do", "Boa", "Grinch", "Zimmy", "Berri"],
    "Mythical": [ "Deshun", "Zafuu", "Channon", "EyexDJ"],
    "Secret":   ["Ted"],
    "Celestial":["admin Zy", "Alex"]
}

# Server-side descriptions (only revealed for OWNED units)
SPECIALS = {
    "Berri": "Strawberry Jell‑O — 150% ATK to target; then choose: heal self for 100% of damage dealt OR gain a stacking buff equal to +50% of the target’s current ATK (stacks and persists until stage end). CD 2.",
    "EyexDJ": "Teleport — When activated, gain \"Teleport\": this unit takes 0 damage from all enemy attacks (bosses included) until it negates damage 10 times (10 teleports). CD 20.",
    "Zimmy": "Ragebait — AOE +25% base ATK damage; Provoke all enemies to target Zimmy, redirect AOE to self, -50% damage taken while active. CD 10.",
    "admin Zy": "Gamma Burst — AOE 220% ATK, apply DEF Down (-30%, 3t), apply Burn (5% of caster ATK, 4t), self +25% ATK (3t). CD 6.",
    "Alex":     "Gluttony — For 2 waves: each attack deals +10% of target max HP as damage and +15% of target current HP as additional damage; heal self 50% of total damage. Reusable after 2 waves.",
    "Ted":      "Vanish — Become invincible (5t). Enemies you attack are slowed -50% SPD while Vanish lasts. CD 10.",
    "Deshun":   "Pay to Win — Roll a die (1–6) for a random effect (stun all 6t / self +25% ATK 5t / DEF Down all 4t / self heal 30% max HP / invincible 2t / AOE 100% ATK). Once per wave.",
    "Zafuu":    "Severe — 300% ATK to a selected target, apply Corrupt (disables specials) and Bleed (5% ATK, 2t). Once per wave.",
    "Channon":  "Aura — Team +25% ATK (2t) and DEF Down all enemies (-30%, 2t). CD 5.",
    "Snorlax":  "Rest — Restore 100% HP to self; if already at full HP, heal the lowest-HP ally by 100% of Snorlax’s base HP. Then apply Sleep (same effect as Stun; bosses immune) to all enemies for 10 turns. Once per wave.",
    "Fatima Do":"Florish — Heal all allies for 50% of their max HP. CD 15.",
    "Boa":      "Life — Revive a fallen ally at 50% max HP (or heal 50% if alive) and grant +100% ATK (5t). Once per stage.",
    "Grinch":   "Something — (Passive) At 1 HP enter Bloodthirsty (can’t die, +25% ATK per turn up to +200%) for 10 turns, then heal 30% max HP. Once per stage.",
}

CHANCES = {  # base summon rates
    "Common": 0.7,
    "Rare": 0.2735,
    "Ultra": 0.02,
    "Mythical": 0.005,
    "Secret": 0.0005,
    "Celestial": 0.001,
}
SHINY_CHANCE = 1.0 / 4000.0   # not for Secret

# Economy knobs
RARITY_SALE = {               # coin value when selling
    "Common": 25, "Rare": 60, "Ultra": 150, "Mythical": 400, "Secret": 800, "Celestial": 1200
}
RARITY_SHARDS = {             # shards gained when dismantling (per unit)
    "Common": 2, "Rare": 2, "Ultra": 20, "Mythical": 40, "Secret": 120, "Celestial": 160
}
RARITY_LEVEL_MULT = {         # (kept for future balancing)
    "Common": 1.0, "Rare": 1.3, "Ultra": 1.8, "Mythical": 2.8, "Secret": 4.0, "Celestial": 5.5
}
RARITY_ASC_BASE = {           # (kept for future balancing)
    "Common": 5, "Rare": 8, "Ultra": 12, "Mythical": 20, "Secret": 30, "Celestial": 40
}

# ----------------------- Utilities -----------------------
def weighted_choice(pairs):
    total = sum(w for _, w in pairs)
    r = random.random() * total
    for v, w in pairs:
        r -= w
        if r <= 0:
            return v
    return pairs[-1][0]

def roll_rarity():
    pairs = [(k, v) for k, v in CHANCES.items()]
    return weighted_choice(pairs)

def roll_unit():
    rarity = roll_rarity()
    name = random.choice(CATALOG[rarity])
    shiny = False
    if rarity != "Secret":
        shiny = random.random() < SHINY_CHANCE
    celestial = (rarity == "Celestial")
    return name, rarity, shiny, celestial

def make_instance(unit_name, rarity, shiny, celestial):
    return {
        "id": uuid.uuid4().hex,
        "unit_name": unit_name,
        "unit_label": unit_name,
        "rarity": rarity,
        "shiny": bool(shiny),
        "celestial": bool(celestial),
        "level": 1,
        "ascension": 0
    }

def add_to_history(u, pull_item):
    hist = u.get("history", [])
    hist.append(pull_item)
    if len(hist) > 200:
        hist = hist[-200:]
    u["history"] = hist

def index_add(u, unit_name):
    if unit_name not in u["index"]:
        u["index"].append(unit_name)

def add_shards(user, unit_name, rarity, count=None):
    if count is None:
        count = RARITY_SHARDS.get(rarity, 1)
    user.setdefault("shards", {})
    user["shards"][unit_name] = int(user["shards"].get(unit_name, 0)) + int(count)

def _normalize_ids(data):
    ids = data.get("instance_ids")
    if ids is None:
        ids = data.get("ids")
    if ids is None and data.get("instance_id"):
        ids = [data.get("instance_id")]
    if ids is None and data.get("id"):
        ids = [data.get("id")]
    if isinstance(ids, str):
        ids = [ids]
    return ids if isinstance(ids, list) else None

def _normalize_id(data):
    iid = data.get("instance_id") or data.get("id")
    if not iid:
        ids = data.get("instance_ids") or data.get("ids")
        if isinstance(ids, list) and ids:
            iid = ids[0]
    return iid

def _find_instance(user_rec, iid):
    for i, inst in enumerate(user_rec.get("backpack", [])):
        if inst.get("id") == iid:
            return i, inst
    return -1, None

# ----------------------- Pages -----------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/play")
def play_page():
    return render_template("play.html")

@app.route("/team")
def team_page():
    return render_template("team.html")

# ----------------------- Core APIs -----------------------
@app.post("/profile")
def profile():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    return jsonify({"gems": user["gems"], "coins": user["coins"]})

@app.post("/inventory")
def inventory():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    return jsonify({"backpack": user["backpack"], "shards": user.get("shards", {})})

@app.post("/team/get")
def team_get():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    bp_map = {inst["id"]: inst for inst in user.get("backpack", [])}
    ids = user.get("team", [])
    clean = []
    names = set()
    for iid in ids:
        inst = bp_map.get(iid)
        if not inst: continue
        name = inst.get("unit_name")
        if name in names: continue
        clean.append(iid)
        names.add(name)
    if clean != ids:
        user["team"] = clean
        save_db(DB)
    return jsonify({"team": clean})

@app.post("/team/set")
def team_set():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    team_ids = data.get("team_ids") or []
    if not user: return jsonify({"error":"missing username"}), 400
    bp_map = {inst["id"]: inst for inst in user.get("backpack", [])}
    clean = []
    names = set()
    for iid in team_ids:
        inst = bp_map.get(iid)
        if not inst: continue
        if inst.get("unit_name") in names: continue
        clean.append(iid)
        names.add(inst.get("unit_name"))
        if len(clean) >= 3: break
    user["team"] = clean
    save_db(DB)
    return jsonify({"ok": True, "team": clean})

@app.post("/pull")
def pull_one():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    cost = 100
    if user["gems"] < cost:
        return jsonify({"error":"Not enough gems"}), 400

    unit, rarity, shiny, celestial = roll_unit()
    inst = make_instance(unit, rarity, shiny, celestial)
    user["gems"] -= cost
    user["backpack"].append(inst)

    add_to_history(user, {
        "unit_name": unit,
        "unit_label": unit,
        "rarity": rarity,
        "shiny": shiny,
        "celestial": celestial
    })
    index_add(user, unit)
    save_db(DB)

    return jsonify({
        "unit": unit,
        "rarity": rarity,
        "shiny": shiny,
        "celestial": celestial,
        "gems_left": user["gems"],
        "index_count": len(user["index"])
    })

@app.post("/pull10")
def pull_ten():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    cost = 1000
    if user["gems"] < cost:
        return jsonify({"error":"Not enough gems"}), 400
    user["gems"] -= cost

    pulls = []
    for _ in range(10):
        unit, rarity, shiny, celestial = roll_unit()
        inst = make_instance(unit, rarity, shiny, celestial)
        user["backpack"].append(inst)
        pulls.append({
            "unit": unit, "rarity": rarity, "shiny": shiny, "celestial": celestial
        })
        add_to_history(user, {
            "unit_name": unit, "unit_label": unit,
            "rarity": rarity, "shiny": shiny, "celestial": celestial
        })
        index_add(user, unit)

    save_db(DB)
    return jsonify({"pulls": pulls, "gems_left": user["gems"], "index_count": len(user["index"])})

@app.post("/history")
def history():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    return jsonify({
        "gems": user["gems"],
        "coins": user["coins"],
        "pulls": user.get("history", []),
        "index": user.get("index", [])
    })

@app.post("/index_data")
def index_data():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    
    owned_all = [inst["unit_name"] for inst in user["backpack"]]
    owned_norm = set(inst["unit_name"] for inst in user["backpack"] if not inst.get("shiny"))
    owned_shiny = set(inst["unit_name"] for inst in user["backpack"] if inst.get("shiny"))
    owned_any = set(owned_all)

    rarities = {}
    for r in ORDER:
        lst = []
        for name in CATALOG[r]:
            lst.append({
                "name": name,
                "owned": (name in owned_any),
                "owned_normal": (name in owned_norm),
                "owned_shiny": (name in owned_shiny)
            })
        rarities[r] = lst

    reveal = {}
    for name, desc in SPECIALS.items():
        if name in owned_norm:
            reveal[name] = desc

    return jsonify({
        "order": ORDER,
        "rarities": rarities,
        "specials": reveal,
        "chances": CHANCES,
        "shinyChance": SHINY_CHANCE
    })

# ----------------------- Stage progression -----------------------
@app.post("/progress/get")
def progress_get():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    mx = int(user.get("max_cleared", 0))
    return jsonify({"max_cleared": mx, "next_allowed": mx + 1})

@app.post("/stage/complete")
def stage_complete():
    data = request.get_json(force=True)
    user = get_user(data.get("username"))
    if not user: return jsonify({"error":"missing username"}), 400
    stage_id = int(data.get("stage_id") or 1)
    victory = bool(data.get("victory"))

    rewards = {}
    if victory:
        coins_gain = 80 * stage_id + (120 if stage_id == 5 else 0)
        gems_gain = 20 if stage_id < 5 else 60
        user["coins"] += coins_gain
        user["gems"] += gems_gain
        rewards = {"coins": coins_gain, "gems": gems_gain}
        if stage_id == int(user.get("max_cleared", 0)) + 1:
            user["max_cleared"] = stage_id

    save_db(DB)
    return jsonify({
        "ok": True,
        "rewards": rewards,
        "gems": user["gems"],
        "coins": user["coins"],
        "max_cleared": user.get("max_cleared", 0)
    })

# ----------------------- Inventory actions -----------------------
SELL_VALUES = {
    "Common": 50, "Rare": 150, "Ultra": 400,
    "Mythical": 1200, "Secret": 5000, "Celestial": 8000
}
def _sell_value(inst):
    base = SELL_VALUES.get(inst.get("rarity"), RARITY_SALE.get(inst.get("rarity"), 25))
    if inst.get("celestial"):
        base = int(base * 1.35)
    elif inst.get("shiny"):
        base = int(base * 1.25)
    return base

@app.route('/inventory/sell', methods=['POST'])
def inventory_sell():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    if not user:
        return jsonify({"error": "Missing username"}), 400

    ids = _normalize_ids(data)
    if not ids:
        return jsonify({"error": "Provide instance_ids[]"}), 400

    team_set = set(user.get("team", []))
    blocked = [iid for iid in ids if iid in team_set]
    if blocked:
        return jsonify({"error": "Cannot sell units that are on your team.", "blocked": blocked}), 400

    coins_gained = 0
    kept = []
    target = set(ids)
    for inst in user.get("backpack", []):
        if inst.get("id") in target:
            coins_gained += _sell_value(inst)
        else:
            kept.append(inst)

    user["backpack"] = kept
    user["coins"] = int(user.get("coins", 0)) + coins_gained
    save_db(DB)

    return jsonify({
        "coins_gained": coins_gained,
        "coins": user["coins"],
        "backpack": user.get("backpack", [])
    })

@app.route('/inventory/dismantle', methods=['POST'])
def inventory_dismantle():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    if not user:
        return jsonify({"error": "Missing username"}), 400

    iid = _normalize_id(data)
    if not iid:
        return jsonify({"error": "Provide instance_id"}), 400

    if iid in set(user.get("team", [])):
        return jsonify({"error": "Cannot dismantle a unit that is on your team."}), 400

    idx, inst = _find_instance(user, iid)
    if idx < 0:
        return jsonify({"error": "Instance not found"}), 404

    add_shards(user, inst["unit_name"], inst["rarity"])
    del user["backpack"][idx]
    save_db(DB)

    return jsonify({
        "backpack": user.get("backpack", []),
        "shards": user.get("shards", {})
    })

@app.route('/inventory/dismantle_selected', methods=['POST'])
def inventory_dismantle_selected():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    if not user:
        return jsonify({"error": "Missing username"}), 400

    ids = _normalize_ids(data)
    if not ids:
        return jsonify({"error": "Provide instance_ids[]"}), 400

    team_set = set(user.get("team", []))
    if any(i in team_set for i in ids):
        return jsonify({"error": "Cannot dismantle units that are on your team."}), 400

    idset = set(ids)
    new_backpack = []
    for inst in user.get("backpack", []):
        if inst.get("id") in idset:
            add_shards(user, inst["unit_name"], inst["rarity"])
        else:
            new_backpack.append(inst)

    user["backpack"] = new_backpack
    save_db(DB)

    return jsonify({
        "backpack": user.get("backpack", []),
        "shards": user.get("shards", {})
    })

# ----------------------- Upgrades -----------------------
LEVEL_MAX = 80
def level_cost(current_level: int) -> int:
    return 50 * max(1, int(current_level))

ASC_MAX = 5
ASC_SHARD_REQ = {
    "Common": 10, "Rare": 20, "Ultra": 40,
    "Mythical": 80, "Secret": 120, "Celestial": 160
}

@app.route('/upgrade/level', methods=['POST'])
def upgrade_level():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    iid = data.get('instance_id') or data.get('id')
    if not user:
        return jsonify({"error": "Missing username"}), 400
    if not iid:
        return jsonify({"error": "Provide instance_id"}), 400

    idx, inst = _find_instance(user, iid)
    if idx < 0:
        return jsonify({"error": "Instance not found"}), 404

    cur_lv = int(inst.get("level", 1))
    if cur_lv >= LEVEL_MAX:
        return jsonify({"error": "Already at max level"}), 400

    cost = level_cost(cur_lv)
    coins = int(user.get("coins", 0))
    if coins < cost:
        return jsonify({"error": f"Not enough coins ({coins}/{cost})"}), 400

    user["coins"] = coins - cost
    inst["level"] = cur_lv + 1
    user["backpack"][idx] = inst
    save_db(DB)

    return jsonify({
        "ok": True,
        "coins": user["coins"],
        "inst": inst
    })

@app.route('/upgrade/ascend', methods=['POST'])
def upgrade_ascend():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    iid = data.get('instance_id') or data.get('id')
    if not user:
        return jsonify({"error": "Missing username"}), 400
    if not iid:
        return jsonify({"error": "Provide instance_id"}), 400

    idx, inst = _find_instance(user, iid)
    if idx < 0:
        return jsonify({"error": "Instance not found"}), 404

    cur_asc = int(inst.get("ascension", 0))
    if cur_asc >= ASC_MAX:
        return jsonify({"error": "Already at max ascension"}), 400

    rarity = inst.get("rarity", "Common")
    req = ASC_SHARD_REQ.get(rarity, 10)
    name = inst.get("unit_name")
    have = int(user.get("shards", {}).get(name, 0))
    if have < req:
        return jsonify({"error": f"Not enough shards for {name} ({have}/{req})"}), 400

    user["shards"][name] = have - req
    inst["ascension"] = cur_asc + 1
    user["backpack"][idx] = inst
    save_db(DB)

    return jsonify({
        "ok": True,
        "inst": inst,
        "shards": user.get("shards", {})
    })

# ----------------------- Run -----------------------
if __name__ == "__main__":
    # First boot: ensure structure even if file existed but was invalid
    ensure_users_key()
    app.run(host="0.0.0.0", port=5000, debug=True)

