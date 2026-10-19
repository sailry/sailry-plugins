const values = {
  en:{credits:'Credits',remaining:'Remaining',package:'Package',failed:'Unable to read credits',permission:'Channel unavailable'},
  'zh-CN':{credits:'积分',remaining:'剩余',package:'积分包',failed:'无法读取积分',permission:'渠道不可用'},
  'zh-TW':{credits:'點數',remaining:'剩餘',package:'點數包',failed:'無法讀取點數',permission:'管道無法使用'},
  de:{credits:'Guthaben',remaining:'Verbleibend',package:'Paket',failed:'Guthaben konnte nicht gelesen werden',permission:'Kanal nicht verfügbar'},
  es:{credits:'Créditos',remaining:'Restantes',package:'Paquete',failed:'No se pudieron leer los créditos',permission:'Canal no disponible'},
  fr:{credits:'Crédits',remaining:'Restants',package:'Forfait',failed:'Impossible de lire les crédits',permission:'Canal indisponible'},
  ja:{credits:'クレジット',remaining:'残り',package:'パッケージ',failed:'クレジットを取得できません',permission:'チャネルを利用できません'},
  ko:{credits:'크레딧',remaining:'잔여',package:'패키지',failed:'크레딧을 읽을 수 없습니다',permission:'채널을 사용할 수 없습니다'},
  'pt-BR':{credits:'Créditos',remaining:'Restantes',package:'Pacote',failed:'Não foi possível consultar os créditos',permission:'Canal indisponível'},
  ru:{credits:'Кредиты',remaining:'Осталось',package:'Пакет',failed:'Не удалось получить кредиты',permission:'Канал недоступен'},
};
export function messages(locale) {return values[locale] ?? values.en;}
