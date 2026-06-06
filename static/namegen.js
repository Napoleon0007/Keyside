/* ============================================================
   Keyside — The Name Forge.
   Generates band / rapper / crew names from a few inputs.
   Pure client-side, no API. Additive.
   ============================================================ */
(function () {
  "use strict";

  var section = document.getElementById("section-namegen");
  if (!section) return;

  var typesEl   = document.getElementById("ngTypes");
  var nameEl    = document.getElementById("ngName");
  var colorEl   = document.getElementById("ngColor");
  var vibeEl    = document.getElementById("ngVibe");
  var goEl      = document.getElementById("ngGo");
  var resultsEl = document.getElementById("ngResults");
  var type = "band";

  /* ---- Word banks --------------------------------------------------- */
  var NOUNS  = ["Wolves","Saints","Echoes","Ghosts","Kings","Tigers","Ravens","Embers","Tides","Vultures","Prophets","Dahlias","Serpents","Monks","Phantoms","Comets","Riots","Halos","Vipers","Mirrors","Lions","Angels","Bandits","Owls","Hounds"];
  var ADJ    = ["Velvet","Electric","Hollow","Crooked","Golden","Savage","Silent","Wild","Neon","Broken","Sacred","Restless","Midnight","Lonesome","Feral","Distant","Dizzy","Holy","Bitter","Lush"];
  var RPREF  = ["Lil","Young","Big","MC","Yung","King","Saint","Baby","Sir"];
  var RSUFF  = ["Stackz","Beatz","Vega","Mane","Blanco","Supreme","Gritz","Wave","Flux","Nova","Sosa","Glo","Vandal","Zo"];
  var CREW   = ["Collective","Syndicate","Society","Cartel","Union","Order","Division","Coalition","Sound","Records","Empire","Foundation","Crew","Movement"];

  var COLORS = {
    red:"Crimson", crimson:"Crimson", blue:"Cobalt", cobalt:"Cobalt", green:"Emerald", emerald:"Emerald",
    black:"Obsidian", white:"Ivory", gold:"Golden", golden:"Golden", yellow:"Amber", amber:"Amber",
    purple:"Violet", violet:"Violet", pink:"Rose", rose:"Rose", orange:"Ember", silver:"Silver",
    grey:"Ashen", gray:"Ashen", teal:"Teal", brown:"Sable"
  };

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ""; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function colorWord(c) {
    c = (c || "").trim().toLowerCase();
    if (!c) return pick(["Crimson","Cobalt","Golden","Violet","Obsidian","Ember"]);
    return COLORS[c] || cap(c);
  }
  function nameWord(n) {
    n = (n || "").trim();
    if (!n) return null;
    return cap(n.split(/\s+/)[0]);
  }

  /* ---- Generators per type ------------------------------------------ */
  function genBand(name, color, vibe) {
    var col = colorWord(color);
    var nm = nameWord(name);
    var vb = vibe ? cap(vibe) : null;
    var patterns = [
      function () { return "The " + pick(ADJ) + " " + pick(NOUNS); },
      function () { return col + " " + pick(NOUNS); },
      function () { return pick(NOUNS) + " & the " + pick(NOUNS); },
      function () { return (vb || pick(ADJ)) + " " + pick(NOUNS); },
      function () { return nm ? "The " + nm + " " + pick(NOUNS) : "The " + pick(ADJ) + " " + pick(NOUNS); },
      function () { return "The " + col + " " + pick(NOUNS); }
    ];
    return pick(patterns)();
  }

  function genRapper(name, color, vibe) {
    var col = colorWord(color);
    var nm = nameWord(name);
    var vb = vibe ? cap(vibe) : null;
    var seed = vb || nm || col;
    var patterns = [
      function () { return pick(RPREF) + " " + seed; },
      function () { return (nm ? nm.charAt(0) : seed.charAt(0)) + "-" + pick(RSUFF); },
      function () { return seed + " " + pick(RSUFF); },
      function () { return "Young " + col; },
      function () { return seed + pick(["$", "x", " Supreme", "velli"]); },
      function () { return "MC " + (vb || col); }
    ];
    return pick(patterns)();
  }

  function genCrew(name, color, vibe) {
    var col = colorWord(color);
    var nm = nameWord(name);
    var vb = vibe ? cap(vibe) : null;
    var seed = vb || col;
    var patterns = [
      function () { return seed + " " + pick(CREW); },
      function () { return col + "wave"; },
      function () { return "DJ " + (nm || vb || col); },
      function () { return pick(ADJ) + " " + pick(CREW); },
      function () { return (nm || seed) + " " + pick(CREW); },
      function () { return seed + " // " + pick(CREW); }
    ];
    return pick(patterns)();
  }

  var GEN = { band: genBand, rapper: genRapper, crew: genCrew };

  /* ---- Render ------------------------------------------------------- */
  function forge() {
    var name = nameEl.value, color = colorEl.value, vibe = vibeEl.value;
    var gen = GEN[type] || genBand;
    var out = [], guard = 0;
    while (out.length < 5 && guard < 60) {
      var n = gen(name, color, vibe).trim();
      if (out.indexOf(n) === -1) out.push(n);
      guard++;
    }
    resultsEl.innerHTML = "";
    out.forEach(function (n, i) {
      var li = document.createElement("li");
      li.style.animationDelay = (i * 0.05) + "s";
      li.innerHTML = "<span>" + n + "</span><span class=\"ng-copy\">tap to copy</span>";
      li.addEventListener("click", function () { copy(n, li); });
      resultsEl.appendChild(li);
    });
  }

  function copy(text, li) {
    var done = function () {
      li.classList.add("copied");
      var tag = li.querySelector(".ng-copy");
      if (tag) tag.textContent = "copied ✓";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  }

  /* ---- Wire --------------------------------------------------------- */
  typesEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".ng-type");
    if (!btn) return;
    type = btn.dataset.type;
    Array.prototype.forEach.call(typesEl.children, function (b) {
      b.classList.toggle("active", b === btn);
    });
    forge();
  });
  goEl.addEventListener("click", forge);
  [nameEl, colorEl, vibeEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") forge(); });
  });

  forge();
})();
