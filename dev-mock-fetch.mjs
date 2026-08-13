// Test-only shim: sandbox has no network access to api.airtable.com,
// so this stubs global.fetch with representative sample data to verify
// build.js produces correct HTML/JSON-LD/sitemap output.
const sample = {
  records: [
    { id: 'rec0000001', fields: { Image: [{ url: 'https://example.com/photo1.jpg', thumbnails: { large: { url: 'https://example.com/photo1-large.jpg' } } }], Title: 'Джазовий вечір з Оркестром Києва', Snippet: 'Атмосферний джазовий концерт у супроводі струнного квартету, який перенесе вас у Нью-Йорк 1950-х років.', Date: '15 серпня', Location: 'Будинок офіцерів, Київ', Category: 'Джаз', Price: '450 грн', Link: 'https://concert.ua/example1', Status: 'Топ' } },
    { id: 'rec0000002', fields: { Image: 'https://example.com/photo2-plain-url.jpg', Title: 'Реквієм Моцарта', Snippet: 'Виконання одного з найвідоміших творів класичної музики у супроводі симфонічного оркестру.', Date: '16 серпня', Location: 'Національна філармонія', Category: 'Класика', Price: '600 грн', Link: 'https://concert.ua/example2' } },
    { id: 'rec0000003', fields: { Title: 'Трибьют Queen: Bohemian Night', Snippet: 'Живе виконання найвідоміших хітів гурту Queen у виконанні київського трибьют-гурту.', Date: 'сьогодні', Location: 'Atlas', Category: 'Трибьюти', Price: '350 грн', Link: 'https://concert.ua/example3' } },
    { id: 'rec0000004', fields: { Title: 'Камерна музика при свічках', Snippet: 'Інтимний вечір камерної музики Баха і Вівальді при свічках.', Date: '18 серпня', Location: 'Костел Св. Миколая', Category: 'Класика', Price: 'Вільний вхід', Link: 'https://concert.ua/example4' } },
    { id: 'rec0000005', fields: { Title: 'Джем-сейшн: молоді таланти', Snippet: 'Імпровізаційний джазовий вечір за участі студентів консерваторії.', Date: '19 серпня', Location: 'Джаз-клуб Caribbean', Category: 'Джаз', Price: '250 грн', Link: 'https://concert.ua/example5' } },
    { id: 'rec0000006', fields: { Title: 'Трибьют Pink Floyd', Snippet: 'Психоделічне шоу з візуальними ефектами на честь легендарного гурту.', Date: '20 серпня', Location: 'Bel Etage', Category: 'Трибьюти', Price: '500 грн', Link: 'https://concert.ua/example6' } },
    { id: 'rec0000007', fields: { Title: 'Вечір фортепіанної музики', Snippet: 'Соло-концерт лауреата міжнародних конкурсів.', Date: 'найближчим часом', Location: 'Колонний зал', Category: 'Класика', Price: '400 грн', Link: 'https://concert.ua/example7' } },
    { id: 'rec0000008', fields: { Title: 'Ретро-джаз вечірка', Swipe: '', Snippet: 'Танцювальна джазова вечірка у стилі свінг.', Date: '21 серпня', Location: 'Freud', Category: 'Джаз', Price: '300 грн', Link: 'https://concert.ua/example8' } },
  ],
};

global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => sample,
  text: async () => JSON.stringify(sample),
});
