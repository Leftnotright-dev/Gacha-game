# app.py
import json, os, random, time, uuid, copy
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
            "index": [],
            "memory_shards": copy.deepcopy(DEFAULT_MEMORY_STATE)
        }
        save_db(DB)
    user = DB["users"][username]
    ensure_memory_struct(user)
    return user

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

# ----------------------- Memory Shards system -----------------------
DEFAULT_MEMORY_STATE = {
    "inventory": [],
    "equipped": {}
}

MEMORY_SLOT_LIMIT = 3

MEMORY_STAGE_SCALES = {
    "attack_pct": 0.0045,
    "defense_pct": 0.0035,
    "hp_pct": 0.0050,
    "speed_pct": 0.0025
}

MEMORY_STAGE_FLAT_SCALES = {
    "attack_flat": 6,
    "defense_flat": 4,
    "hp_flat": 18,
    "speed_flat": 1.2
}

def _stage_tags(stage_id):
    try:
        stage_id = int(stage_id)
    except (TypeError, ValueError):
        stage_id = 1
    if stage_id >= 9:
        return ["chrono", f"stage-{stage_id}"]
    if stage_id >= 7:
        return ["abyssal", f"stage-{stage_id}"]
    if stage_id >= 5:
        return ["infernal", f"stage-{stage_id}"]
    if stage_id >= 3:
        return ["campaign", f"stage-{stage_id}"]
    return ["training", f"stage-{stage_id}"]

def _fmt_text(text, stage_id, unit_name, victory):
    if not isinstance(text, str):
        return text
    result = text
    try:
        result = text.format(stage=stage_id, unit=unit_name, result="victory" if victory else "defeat")
    except KeyError:
        result = text
    return result

def _round_effects(effects):
    rounded = {}
    for key, val in (effects or {}).items():
        if isinstance(val, (int, float)):
            rounded[key] = round(float(val), 6)
    return rounded

def _scale_effects(effects, stage_id):
    scaled = {}
    for key, val in (effects or {}).items():
        if not isinstance(val, (int, float)):
            continue
        base = float(val)
        if key in MEMORY_STAGE_SCALES:
            delta = MEMORY_STAGE_SCALES[key] * max(0, int(stage_id))
            if base < 0:
                delta = -delta
            base += delta
        elif key in MEMORY_STAGE_FLAT_SCALES:
            delta = MEMORY_STAGE_FLAT_SCALES[key] * max(0, int(stage_id))
            if base < 0:
                delta = -delta
            base += delta
        scaled[key] = round(base, 6)
    return scaled

MEMORY_VICTORY_TEMPLATES = [
    {
        "key": "battle_triumph",
        "title": "Echo of Triumph",
        "tags": ["victory", "resolve", "momentum"],
        "effects": {"attack_pct": 0.04, "speed_pct": 0.01},
        "notes": "Confidence from a decisive strike quickens every motion.",
        "story": "Stage {stage} victory lit a spark in {unit}, who now lunges with fearless momentum."
    },
    {
        "key": "alliance_oath",
        "title": "Alliance Oath",
        "tags": ["victory", "alliance", "bond"],
        "effects": {"hp_pct": 0.05, "defense_pct": 0.03},
        "notes": "A battlefield oath reinforces their guard alongside allies.",
        "story": "Allies clasped hands after Stage {stage}, and {unit} swore never to break the line again."
    },
    {
        "key": "pyromancer_training",
        "title": "Pyromancer Training",
        "tags": ["victory", "pyromancy", "discipline"],
        "effects": {"attack_pct": 0.05, "speed_pct": 0.015},
        "notes": "Harnessed abyssal fire with ruthless focus.",
        "story": "Training alongside flamecasters after Stage {stage} taught {unit} to bend heat without hesitation."
    }
]

MEMORY_DEFEAT_TEMPLATES = [
    {
        "key": "fear_of_fire",
        "title": "Fear of Fire",
        "tags": ["defeat", "fear", "fire"],
        "effects": {"defense_pct": 0.05, "attack_pct": -0.02},
        "notes": "Winces at sparks, guarding carefully but striking slower.",
        "story": "Singed during Stage {stage}, {unit} now keeps distance from burning arcs.",
        "conflicts": [
            {
                "tag": "pyromancy",
                "effects": {"defense_pct": -0.04},
                "note": "Panic resurfaces next to flame-obsessed allies."
            }
        ]
    },
    {
        "key": "betrayal_trauma",
        "title": "Trauma: Betrayed by Allies",
        "tags": ["defeat", "trauma", "betrayal"],
        "effects": {"hp_pct": 0.04, "defense_pct": 0.03, "attack_pct": -0.03},
        "notes": "Steel your heart, but trust falters.",
        "story": "Left behind during Stage {stage}, {unit} steels their heart yet hesitates beside unproven allies.",
        "conflicts": [
            {
                "tag": "betrayal",
                "effects": {"attack_pct": -0.05, "speed_pct": -0.03},
                "note": "Trust collapses when allies carry betrayal memories."
            }
        ]
    },
    {
        "key": "self_sacrifice",
        "title": "Self-Sacrifice",
        "tags": ["defeat", "sacrifice", "resolve"],
        "effects": {"hp_pct": 0.05, "defense_pct": 0.02, "speed_pct": -0.02},
        "notes": "Shoulders weight for the team, even if pace slows.",
        "story": "Stage {stage} ended in retreat, yet {unit} recalls shielding their allies from the final blow."
    }
]

def ensure_memory_struct(user):
    mem = user.get("memory_shards")
    if not isinstance(mem, dict):
        mem = copy.deepcopy(DEFAULT_MEMORY_STATE)
        user["memory_shards"] = mem
    else:
        if not isinstance(mem.get("inventory"), list):
            mem["inventory"] = []
        if not isinstance(mem.get("equipped"), dict):
            mem["equipped"] = {}
    return mem

def _instantiate_memory_shard(template, stage_id, inst, victory):
    tpl = copy.deepcopy(template)
    unit_name = inst.get("unit_name") or inst.get("unit_label") or "Unknown"
    shard = {
        "id": uuid.uuid4().hex,
        "key": tpl.get("key", "memory"),
        "title": _fmt_text(tpl.get("title", "Memory Shard"), stage_id, unit_name, victory),
        "tags": list(dict.fromkeys((tpl.get("tags") or []) + _stage_tags(stage_id) + (["victory"] if victory else ["defeat"]))),
        "effects": _scale_effects(tpl.get("effects"), stage_id),
        "notes": _fmt_text(tpl.get("notes"), stage_id, unit_name, victory),
        "story": _fmt_text(tpl.get("story"), stage_id, unit_name, victory),
        "created_at": _now(),
        "origin": {
            "stage": int(stage_id),
            "result": "victory" if victory else "defeat",
            "unit_id": inst.get("id"),
            "unit_name": unit_name
        },
        "conflicts": []
    }
    conflicts = tpl.get("conflicts") or []
    for conf in conflicts:
        if not isinstance(conf, dict):
            continue
        eff = _scale_effects(conf.get("effects"), stage_id)
        shard["conflicts"].append({
            "tag": conf.get("tag"),
            "effects": eff,
            "note": _fmt_text(conf.get("note"), stage_id, unit_name, victory)
        })
    return shard

def memory_generate_for_stage(user, stage_id, victory):
    mem = ensure_memory_struct(user)
    team_ids = list(user.get("team", []) or [])
    if not team_ids:
        return []
    bp_map = {inst.get("id"): inst for inst in user.get("backpack", [])}
    templates = MEMORY_VICTORY_TEMPLATES if victory else MEMORY_DEFEAT_TEMPLATES
    new_shards = []
    for iid in team_ids:
        inst = bp_map.get(iid)
        if not inst:
            continue
        tpl = random.choice(templates)
        shard = _instantiate_memory_shard(tpl, stage_id, inst, victory)
        mem.setdefault("inventory", []).append(shard)
        new_shards.append(shard)
    return new_shards

def memory_clear_instances(user, instance_ids):
    mem = ensure_memory_struct(user)
    changed = False
    for iid in instance_ids:
        if iid in mem.get("equipped", {}):
            del mem["equipped"][iid]
            changed = True
    return changed

def memory_find_shard(mem, shard_id):
    for shard in mem.get("inventory", []):
        if shard.get("id") == shard_id:
            return shard
    return None

def memory_remove_shards(mem, shard_ids):
    shard_ids = set(shard_ids)
    mem["inventory"] = [sh for sh in mem.get("inventory", []) if sh.get("id") not in shard_ids]
    for inst_id, ids in list(mem.get("equipped", {}).items()):
        new_ids = [sid for sid in ids if sid not in shard_ids]
        if new_ids:
            mem["equipped"][inst_id] = new_ids
        else:
            del mem["equipped"][inst_id]

def _fusion_unstable_flame(shards):
    stage = max((sh.get("origin", {}).get("stage") or 1) for sh in shards if isinstance(sh, dict))
    titles = ", ".join(sh.get("title", "") for sh in shards)
    fused = {
        "key": "unstable_flame_channeler",
        "title": "Unstable Flame Channeler",
        "tags": ["pyromancy", "fear", "volatile"],
        "effects": _scale_effects({"attack_pct": 0.12, "speed_pct": 0.03, "defense_pct": -0.05}, stage),
        "notes": "Fire surges wildly — overwhelming output but scorched defenses.",
        "story": f"Balancing {titles}, the wielder channels violent flames that threaten to consume them.",
        "conflicts": [
            {
                "tag": "water",
                "effects": {"attack_pct": -0.03},
                "note": "Dampening support douses their unstable momentum."
            }
        ]
    }
    return fused

def _default_fusion(shards):
    stage = max((sh.get("origin", {}).get("stage") or 1) for sh in shards if isinstance(sh, dict))
    titles = [sh.get("title", "Memory") for sh in shards]
    combined_effects = {}
    for shard in shards:
        for key, val in (shard.get("effects") or {}).items():
            if isinstance(val, (int, float)):
                combined_effects[key] = combined_effects.get(key, 0.0) + float(val)
    # slight resonance bonus
    for key in list(combined_effects.keys()):
        combined_effects[key] *= 1.05
    combined_effects = _scale_effects(combined_effects, max(stage, 1))
    notes = [sh.get("notes") for sh in shards if sh.get("notes")]
    story = "Memories fuse, echoing both triumphs and scars."
    return {
        "key": "memory_fusion",
        "title": f"Fusion of {titles[0]} + {titles[1] if len(titles) > 1 else titles[0]}",
        "tags": list(dict.fromkeys(["fusion"] + [tag for sh in shards for tag in (sh.get("tags") or [])])),
        "effects": combined_effects,
        "notes": " / ".join(notes) if notes else "Interwoven recollections empower new instincts.",
        "story": story,
        "conflicts": [conf for sh in shards for conf in (sh.get("conflicts") or [])]
    }

FUSION_RECIPES = {
    frozenset(["fear_of_fire", "pyromancer_training"]): _fusion_unstable_flame
}

def memory_fuse(user, shard_ids):
    mem = ensure_memory_struct(user)
    if not isinstance(shard_ids, list) or len(shard_ids) < 2:
        raise ValueError("Select at least two shards to fuse")
    shard_ids = shard_ids[:2]
    shards = []
    for sid in shard_ids:
        shard = memory_find_shard(mem, sid)
        if not shard:
            raise ValueError(f"Shard {sid} not found")
        shards.append(shard)
    keys = frozenset(sh.get("key") for sh in shards)
    if keys in FUSION_RECIPES:
        fused = FUSION_RECIPES[keys](shards)
    else:
        fused = _default_fusion(shards)
    stage = max((sh.get("origin", {}).get("stage") or 1) for sh in shards if isinstance(sh, dict))
    fused["id"] = uuid.uuid4().hex
    fused["tags"] = list(dict.fromkeys((fused.get("tags") or []) + _stage_tags(stage) + ["fusion"]))
    fused["effects"] = _round_effects(fused.get("effects"))
    fused["notes"] = _fmt_text(fused.get("notes"), stage, "", True)
    fused["story"] = _fmt_text(fused.get("story"), stage, "", True)
    fused["created_at"] = _now()
    fused["origin"] = {
        "result": "fusion",
        "components": [sh.get("id") for sh in shards],
        "stage": stage
    }
    # Remove old shards and unequip them
    memory_remove_shards(mem, shard_ids)
    mem.setdefault("inventory", []).append(fused)
    return fused

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
    mem = ensure_memory_struct(user)
    return jsonify({
        "backpack": user["backpack"],
        "shards": user.get("shards", {}),
        "memory": mem
    })

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
        if name in owned_any:
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

    new_shards = memory_generate_for_stage(user, stage_id, victory)
    mem = ensure_memory_struct(user)
    save_db(DB)
    return jsonify({
        "ok": True,
        "rewards": rewards,
        "gems": user["gems"],
        "coins": user["coins"],
        "max_cleared": user.get("max_cleared", 0),
        "memory": mem,
        "new_shards": new_shards
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
    mem = ensure_memory_struct(user)

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
    memory_clear_instances(user, target)
    save_db(DB)

    return jsonify({
        "coins_gained": coins_gained,
        "coins": user["coins"],
        "backpack": user.get("backpack", []),
        "memory": mem
    })

@app.route('/inventory/dismantle', methods=['POST'])
def inventory_dismantle():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    if not user:
        return jsonify({"error": "Missing username"}), 400
    mem = ensure_memory_struct(user)

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
    memory_clear_instances(user, [iid])
    save_db(DB)

    return jsonify({
        "backpack": user.get("backpack", []),
        "shards": user.get("shards", {}),
        "memory": mem
    })

@app.route('/inventory/dismantle_selected', methods=['POST'])
def inventory_dismantle_selected():
    data = request.get_json(force=True) or {}
    user = get_user(data.get('username'))
    if not user:
        return jsonify({"error": "Missing username"}), 400
    mem = ensure_memory_struct(user)

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
    memory_clear_instances(user, idset)
    save_db(DB)

    return jsonify({
        "backpack": user.get("backpack", []),
        "shards": user.get("shards", {}),
        "memory": mem
    })

# ----------------------- Memory Shard endpoints -----------------------
@app.post("/memory/list")
def memory_list():
    data = request.get_json(force=True) or {}
    user = get_user(data.get("username"))
    if not user:
        return jsonify({"error": "Missing username"}), 400
    mem = ensure_memory_struct(user)
    return jsonify({"memory": mem})

@app.post("/memory/equip")
def memory_equip():
    data = request.get_json(force=True) or {}
    user = get_user(data.get("username"))
    if not user:
        return jsonify({"error": "Missing username"}), 400
    mem = ensure_memory_struct(user)

    iid = _normalize_id(data)
    shard_id = data.get("shard_id")
    if not iid or not shard_id:
        return jsonify({"error": "Provide instance_id and shard_id"}), 400

    idx, inst = _find_instance(user, iid)
    if idx < 0:
        return jsonify({"error": "Instance not found"}), 404

    shard = memory_find_shard(mem, shard_id)
    if not shard:
        return jsonify({"error": "Shard not found"}), 404

    loadout = mem.setdefault("equipped", {}).setdefault(iid, [])
    if shard_id in loadout:
        return jsonify({"ok": True, "memory": mem, "inst": inst})
    if len(loadout) >= MEMORY_SLOT_LIMIT:
        return jsonify({"error": f"Loadout full (max {MEMORY_SLOT_LIMIT})"}), 400

    for other_iid, ids in list(mem.get("equipped", {}).items()):
        if other_iid == iid:
            continue
        if shard_id in ids:
            ids = [sid for sid in ids if sid != shard_id]
            if ids:
                mem["equipped"][other_iid] = ids
            else:
                del mem["equipped"][other_iid]

    loadout.append(shard_id)
    save_db(DB)
    return jsonify({"ok": True, "memory": mem, "inst": inst})

@app.post("/memory/unequip")
def memory_unequip():
    data = request.get_json(force=True) or {}
    user = get_user(data.get("username"))
    if not user:
        return jsonify({"error": "Missing username"}), 400
    mem = ensure_memory_struct(user)

    iid = _normalize_id(data)
    shard_id = data.get("shard_id")
    if not iid or not shard_id:
        return jsonify({"error": "Provide instance_id and shard_id"}), 400

    loadout = mem.get("equipped", {}).get(iid, [])
    if shard_id in loadout:
        loadout = [sid for sid in loadout if sid != shard_id]
        if loadout:
            mem["equipped"][iid] = loadout
        else:
            mem["equipped"].pop(iid, None)
        save_db(DB)
    return jsonify({"ok": True, "memory": mem})

@app.post("/memory/fuse")
def memory_fuse_api():
    data = request.get_json(force=True) or {}
    user = get_user(data.get("username"))
    if not user:
        return jsonify({"error": "Missing username"}), 400
    try:
        shard_ids = data.get("shard_ids") or []
        fused = memory_fuse(user, shard_ids)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    mem = ensure_memory_struct(user)
    save_db(DB)
    return jsonify({"ok": True, "memory": mem, "shard": fused})

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

