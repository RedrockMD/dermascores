# DermaScores verisini Lovable'a aktarma

`index.html` olduğu gibi kalır — bu klasördeki JSON dosyaları ondan **üretilir**, onun yerine geçmez.
Yeni bir Lovable projesinde arayüzü sıfırdan kurup veriyi buradan çekmek için hazırlandı.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `data/criteria.json` | Tanı kriterleri modülünün tamamı — 8 hastalık, 15 kriter seti, 110 madde. **Saf veri, eksiksiz.** |
| `data/calculators.json` | 39 hesaplayıcının kataloğu: id, kategori, ad, açıklama, aralık |
| `data/categories.json` | Kategori anahtarları, iki dilli adları ve renkleri |
| `data/strings.json` | Arayüz metinleri (TR/EN) |
| `data/dermascores.bundle.json` | Yukarıdakilerin hepsi tek dosyada — Lovable'a sürükleyip bırakmak için |

Her metin `{ "tr": "...", "en": "..." }` biçimindedir.

> **Önemli:** `calculators.json` yalnızca **katalog bilgisi** taşır. PASI, EASI, IHS4 gibi
> hesaplayıcıların form yapısı ve puanlama fonksiyonları JSON'a sığmaz (fonksiyondurlar) ve
> `index.html` içinde kalır. Her kayıttaki `"hasLogic": true` bunu belirtir. Yani Lovable'da
> hesaplayıcıları yeniden kurmak isterseniz puanlama mantığını `index.html`'den elle taşımanız gerekir.
> **`criteria.json` ise eksiksizdir** — tanı kriterleri modülü tamamen bu veriden çalışır.

## Veriyi yeniden üretmek

`index.html` değiştiğinde:

```bash
npm run export-data     # data/*.json dosyalarını yeniden üretir
npm run verify-data     # JSON'u gerçek tarayıcıda çalışan uygulamayla karşılaştırır (playwright ister)
```

`verify-data` uygulamayı Chromium'da açar, veriyi canlı olarak okur ve JSON ile karşılaştırır;
id'ler, puanlar, eşikler, bantlar ve grup kuralları birebir tutmazsa hata verir. JSON'u **elle düzenlemeyin** —
kaynak `index.html`.

## `criteria.json` şeması

```jsonc
{
  "count": 8, "setCount": 15,
  "criteria": [{
    "id": "pg", "category": "neut",
    "name": { "tr": "...", "en": "..." },
    "full": { "tr": "...", "en": "..." },
    "relatedCalculators": ["SCORTEN"],     // calculators.json'daki id'ler
    "sets": [ /* sekme olarak gösterilecek kriter setleri */ ],
    "differentials": [{ "tr": "...", "en": "..." }],
    "nextSteps": { "workup": [...], "treatmentOrientation": [...], "referralFlags": [...] },
    "references": ["Su WPD, et al. Int J Dermatol. 2004;43(11):790-800."]
  }]
}
```

Bir `set` dört puanlama tipinden biridir:

| `scoringType` | Alanlar | Kural |
|---|---|---|
| `major-minor` | `groups[]` — her biri `need` ve `items[]` | Her grup kendi `need` sayısına ulaşmalı |
| `mandatory-plus-n` | `mandatory{items}`, `additional{need, items}` | Zorunlu maddelerin tümü + ek listeden `need` kadarı |
| `points-threshold` | `items[]`, `threshold` | Puan toplamı `>= threshold` |
| `points-banded` | `items[]`, `bands[]` | Puan toplamı, `max` değeri artan sırada ilk uyan banda düşer; son bandın `max` değeri `null`'dur (hepsini yakalar) |

Maddeler iki tiptedir:

```jsonc
{ "id": "su_m1", "type": "checkbox", "label": {...}, "hint": {...}, "points": 3, "optional": false }
{ "id": "al_delay", "type": "choice", "label": {...},
  "options": [ { "label": {...}, "points": -3 }, { "label": {...}, "points": 3 } ] }
```

`choice` maddelerinde **ilk seçenek varsayılandır** ve bilinçli olarak en muhafazakâr olanıdır:
ALDEN'de doldurulmamış form "çok olası değil", RegiSCAR DRESS'te "dışlandı" gösterir. Sıralamayı
değiştirirseniz boş form yanlış sonuç verir.

## Değerlendirici (kopyalayıp kullanın)

Puanlamayı yeniden yazmayın — `index.html`'deki mantığın birebir aynısı:

```js
export function evaluate(set, checked /* Set of item ids */, choice /* {itemId: optionIndex} */) {
  const groups =
    set.scoringType === "major-minor" ? set.groups :
    set.scoringType === "mandatory-plus-n" ? [
      { key: "mandatory", short: set.mandatory.short, need: set.mandatory.items.length, items: set.mandatory.items },
      { key: "additional", short: set.additional.short, need: set.additional.need, items: set.additional.items },
    ] : null;

  if (groups) {
    let met = true;
    const detail = groups.map(g => {
      const have = g.items.filter(it => checked.has(it.id)).length;
      const ok = have >= g.need;
      if (!ok) met = false;
      return { key: g.key, short: g.short, have, need: g.need, total: g.items.length, ok };
    });
    return { met, detail };
  }

  const score = set.items.reduce((sum, it) =>
    sum + (it.type === "choice"
      ? (it.options[choice[it.id] ?? 0]?.points ?? 0)
      : (checked.has(it.id) ? (it.points ?? 0) : 0)), 0);

  if (set.scoringType === "points-banded") {
    const band = set.bands.find(b => b.max === null || score <= b.max) ?? set.bands.at(-1);
    return { met: band.met, score, band: band.label };
  }
  return { met: score >= set.threshold, score, threshold: set.threshold };
}
```

Doğrulama için sınır değerleri: ALDEN toplamı **−12…+10**, RegiSCAR DRESS **−4…+9**,
PARACELSUS toplam **20 puan / eşik 10**, IHS4 = nodül + 2×abse + 4×tünel.

## Lovable'a aktarma adımları

1. **Yeni bir Lovable projesi açın** (React + Vite şablonu). Bu repoyu içeri almayın — tek dosyalık
   vanilya JS yapısı Lovable'ın beklediği yapı değil ve önizleme başlamayabilir.
2. **Veriyi yükleyin.** İki yol var:
   - `data/dermascores.bundle.json` dosyasını sohbete sürükleyin, ardından
     "bu JSON'u `src/data/dermascores.json` olarak kaydet" deyin; veya
   - GitHub'dan doğrudan çekin:
     `https://raw.githubusercontent.com/RedrockMD/dermascores/main/data/dermascores.bundle.json`
3. **Bu dosyanın (`LOVABLE.md`) "şema" ve "değerlendirici" bölümlerini de yapıştırın.** Lovable'ın
   puanlama mantığını kendi başına çıkarmasına izin vermeyin — dört puanlama tipi, negatif puanlar ve
   bant sınırları yanlış yorumlanmaya çok açık.
4. **Şu kuralları isteyin:** her sayfada `strings.json`'daki `criteria.banner` uyarısı görünsün;
   `applicabilityNote` alanı olan setlerde o not gösterilsin (sınıflandırma ile tanı kriterini ayırır);
   ilaç dozu yazılmasın; arayüz hekime yönelik olsun.
5. **Reponun adını değiştirmeyin, silmeyin.** Lovable senkronizasyonu kalıcı olarak kopar.

## Geri taşıma

Lovable'da beğendiğiniz bir modülü DermaScores'a almak isterseniz: kriter **verisi** eklendiyse
`index.html` içindeki `CRITERIA` dizisine aynı şekilde ekleyin ve `npm run export-data` çalıştırın.
Arayüz kodunu taşımayın — iki proje farklı mimaride.
