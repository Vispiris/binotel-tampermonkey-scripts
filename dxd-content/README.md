# DXD content updates

Ця папка — джерело оновлень для інженерської версії DXD.

GitHub Raw URL, який використовує програма:

```text
https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/dxd-content
```

Як оновлювати БЗ:

1. Редагуєш статті в адмінській версії DXD.
2. Натискаєш `Експорт БЗ`.
3. Вміст експорту кладеш у папку `dxd-content` в GitHub.
4. У `manifest.json` має змінитися `contentVersion`.
5. Інженерська версія побачить нову версію і запропонує оновлення.

Важливо: якщо додаються нові картинки або інші файли, їх теж треба завантажити в `assets/`, а `assets-manifest.json` має їх містити.
