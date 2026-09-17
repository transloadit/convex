import de from '@uppy/locales/lib/de_DE.js'
import en from '@uppy/locales/lib/en_US.js'
import nl from '@uppy/locales/lib/nl_NL.js'
import uk from '@uppy/locales/lib/uk_UA.js'
import type { Locale } from './locales'

// Fill gaps in the official catalogs for the installed Core/Dashboard/Transloadit versions.
// Ukrainian still uses the old %{browse} placeholder, which Dashboard no longer supplies.
export const uppyLocales: Record<Locale, UppyLocale> = {
  en,
  nl: { ...nl, strings: { ...nl.strings, failedToAddFiles: 'Bestanden toevoegen mislukt' } },
  de: {
    ...de,
    strings: {
      ...de.strings,
      aggregateExceedsSize:
        'Du hast %{size} an Dateien ausgewählt. Erlaubt sind höchstens %{sizeAllowed}.',
      authAborted: 'Anmeldung abgebrochen',
      noSearchResults: 'Leider gibt es keine Ergebnisse für diese Suche',
      logIn: 'Anmelden',
      pickFiles: 'Dateien auswählen',
      pickPhotos: 'Fotos auswählen',
      loadedXFiles: '%{numFiles} Dateien geladen',
      signInWithGoogle: 'Mit Google anmelden',
      search: 'Suchen',
      resetSearch: 'Suche zurücksetzen',
      addedNumFiles: '%{numFiles} Datei(en) hinzugefügt',
      additionalRestrictionsFailed: '%{count} weitere Anforderungen wurden nicht erfüllt',
      unnamed: 'Unbenannt',
      pleaseWait: 'Bitte warten',
      error: 'Fehler',
      dataUploadedOfUnknown: '%{complete} von unbekannter Gesamtgröße',
      showErrorDetails: 'Fehlerdetails anzeigen',
      failedToAddFiles: 'Dateien konnten nicht hinzugefügt werden',
      uploadStalled:
        'Der Upload hat seit %{seconds} Sekunden keinen Fortschritt gemacht. Versuche es erneut.',
    },
  },
  uk: {
    ...uk,
    strings: {
      ...uk.strings,
      aggregateExceedsSize: 'Вибрано файлів на %{size}, але дозволено щонайбільше %{sizeAllowed}',
      noSearchResults: 'На жаль, за цим запитом нічого не знайдено',
      logIn: 'Увійти',
      pickFiles: 'Вибрати файли',
      pickPhotos: 'Вибрати фото',
      loadedXFiles: 'Завантажено файлів: %{numFiles}',
      resetSearch: 'Скинути пошук',
      addedNumFiles: 'Додано файлів: %{numFiles}',
      additionalRestrictionsFailed: 'Не виконано додаткових вимог: %{count}',
      unnamed: 'Без назви',
      pleaseWait: 'Зачекай',
      error: 'Помилка',
      dataUploadedOfUnknown: '%{complete}, загальний розмір невідомий',
      failedToAddFiles: 'Не вдалося додати файли',
      uploadStalled: 'Завантаження не просувається вже %{seconds} секунд. Спробуй ще раз.',
      dropPasteFiles: 'Перетягни файли сюди або %{browseFiles}',
      dropPasteFolders: 'Перетягни папки сюди або %{browseFolders}',
      dropPasteBoth: 'Перетягни файли сюди, %{browseFiles} або %{browseFolders}',
      dropPasteImportFiles: 'Перетягни файли сюди, %{browseFiles} або імпортуй з:',
      dropPasteImportFolders: 'Перетягни папки сюди, %{browseFolders} або імпортуй з:',
      dropPasteImportBoth: 'Перетягни файли сюди, %{browseFiles}, %{browseFolders} або імпортуй з:',
    },
  },
}

import type { Locale as UppyLocale } from '@uppy/core/utils'
