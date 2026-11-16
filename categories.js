/**
 * 自定义分类：名字 + 内置图标或本机上传（裁成圆）。数据在本机，完整备份会带走。
 * 导入「地点/名字」时，名字对得上就归到这个分类，对不上归「其他」。
 */
(function (root) {
  "use strict";

  var KEY = "wishlist-map-categories-v1";
  var DB_NAME = "wishlist-map-images-v1";
  var STORE = "images";

  function str(v) {
    return v == null ? "" : String(v);
  }

  function uid(prefix) {
    return (prefix || "cat") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("no-idb"));
        return;
      }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { resolve(rec); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbDelete(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbAll() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function readList() {
    try {
      var list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function writeList(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list || []));
    } catch (err) {}
    return list;
  }

  function normalize(c) {
    if (!c || typeof c !== "object") return null;
    var name = str(c.name).trim();
    if (!name) return null;
    var out = {
      id: str(c.id) || uid("cat"),
      name: name,
      icon: c.icon && typeof c.icon === "object" ? {
        kind: c.icon.kind === "image" ? "image" : "builtin",
        key: str(c.icon.key),
        imageId: str(c.icon.imageId),
        crop: c.icon.crop || null
      } : { kind: "builtin", key: "place" }
    };
    return out;
  }

  function all() {
    return readList().map(normalize).filter(Boolean);
  }

  function byId(id) {
    var i;
    var list = all();
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function byName(name) {
    var n = str(name).trim().toLowerCase();
    if (!n) return null;
    var list = all();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].name.toLowerCase() === n) return list[i];
    }
    return null;
  }

  function save(cat) {
    var next = normalize(cat);
    if (!next) return null;
    var list = all();
    var i;
    var found = false;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === next.id) {
        list[i] = next;
        found = true;
        break;
      }
    }
    if (!found) list.push(next);
    writeList(list);
    return next;
  }

  function remove(id) {
    var cat = byId(id);
    var list = all().filter(function (c) { return c.id !== id; });
    writeList(list);
    if (cat && cat.icon && cat.icon.imageId) {
      idbDelete(cat.icon.imageId).catch(function () {});
    }
    return true;
  }

  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
    if (!m) return null;
    var bin = atob(m[2]);
    var arr = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || "image/jpeg" });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || "")); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function saveImage(dataUrl) {
    var id = uid("img");
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) return Promise.reject(new Error("bad-data"));
    return idbPut({ id: id, blob: blob, createdAt: Date.now() }).then(function () { return id; });
  }

  function imageDataUrl(id) {
    return idbGet(id).then(function (rec) {
      if (!rec || !rec.blob) return "";
      return blobToDataUrl(rec.blob);
    });
  }

  /**
   * 导入「地点/xxx」：对得上自定义分类名字就用它，否则「其他」。
   * 内置分类（景点、自然、餐厅、咖啡甜点酒吧/甜品、购物、其他）保持原样。
   */
  function matchPlaceSubtype(word) {
    var raw = str(word).trim();
    if (!raw) return { subtype: "", customId: "" };
    var Icons = root.Icons;
    var builtins = ["景点", "自然", "餐厅", "购物", "其他"];
    if (Icons && Icons.CAFE_LABEL) builtins.push(Icons.CAFE_LABEL);
    builtins.push("甜品", "咖啡甜点酒吧");
    var i;
    for (i = 0; i < builtins.length; i++) {
      if (builtins[i] === raw) {
        var mapped = raw === "甜品" && Icons && Icons.CAFE_LABEL ? Icons.CAFE_LABEL : raw;
        return { subtype: mapped, customId: "" };
      }
    }
    var hit = byName(raw);
    if (hit) return { subtype: hit.name, customId: hit.id };
    return { subtype: "其他", customId: "" };
  }

  function forBackup() {
    return all();
  }

  function imagesForBackup() {
    return idbAll().then(function (rows) {
      return Promise.all((rows || []).map(function (r) {
        return blobToDataUrl(r.blob).then(function (dataUrl) {
          return { id: r.id, dataUrl: dataUrl, createdAt: r.createdAt };
        });
      }));
    }).catch(function () { return []; });
  }

  function applyBackup(cats, images, mode) {
    var incoming = (cats || []).map(normalize).filter(Boolean);
    if (mode === "replace") writeList(incoming);
    else {
      var have = {};
      all().forEach(function (c) { have[c.id] = true; have["n:" + c.name.toLowerCase()] = true; });
      incoming.forEach(function (c) {
        if (!have[c.id] && !have["n:" + c.name.toLowerCase()]) save(c);
      });
    }
    var chain = Promise.resolve();
    (images || []).forEach(function (im) {
      if (!im || !im.id || !im.dataUrl) return;
      chain = chain.then(function () {
        var blob = dataUrlToBlob(im.dataUrl);
        if (!blob) return;
        return idbPut({ id: im.id, blob: blob, createdAt: im.createdAt || Date.now() });
      });
    });
    return chain;
  }

  var api = {
    KEY: KEY,
    all: all,
    byId: byId,
    byName: byName,
    save: save,
    remove: remove,
    saveImage: saveImage,
    imageDataUrl: imageDataUrl,
    matchPlaceSubtype: matchPlaceSubtype,
    forBackup: forBackup,
    imagesForBackup: imagesForBackup,
    applyBackup: applyBackup,
    normalize: normalize
  };

  root.Categories = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
