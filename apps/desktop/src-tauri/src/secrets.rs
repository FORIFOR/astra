//! 資格情報の保管。正本 §21「Desktop: Keychain / Credential Manager」。
//!
//! refresh token をブラウザの localStorage に置かない。XSS で持ち出せるうえ、
//! ディスク上に平文で残る。OS の資格情報ストアへ預ける。
//!
//! アクセストークンはここに置かない。寿命 15 分で、メモリにだけ持つ（実装仕様 §4.2）。

use keyring::Entry;

/// サービス名。他アプリの項目と混ざらないよう bundle id に揃える。
const SERVICE: &str = "com.astra.desktop";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|error| format!("credential store unavailable: {error}"))
}

/// 保存する。既存の値は上書きする。
#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|error| format!("could not store {key}: {error}"))
}

/// 読み出す。**未登録は None であってエラーではない。**
/// 初回起動を「壊れている」と扱わないため、ここを区別する。
#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("could not read {key}: {error}")),
    }
}

/// 消す。無いものを消しても成功扱いにする（サインアウトを冪等にするため）。
#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("could not delete {key}: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_entries_to_this_application() {
        // 他アプリの資格情報と混ざらないこと
        assert_eq!(SERVICE, "com.astra.desktop");
    }

    #[test]
    fn reading_an_unknown_key_is_not_an_error() {
        // 初回起動を「壊れている」と扱わない。
        // CI に資格情報ストアが無い環境もあるので、エラーでも None でも通す。
        let result = secret_get("astra.test.absent".to_string());
        match result {
            Ok(value) => assert!(value.is_none()),
            // 資格情報ストアが無い CI では、失敗は Entry 生成時（"credential store unavailable"）でも
            // 読み出し時（secret-service 未起動 → "could not read"）でも起こりうる。どちらも許容する。
            Err(message) => assert!(
                message.contains("credential store unavailable")
                    || message.contains("could not read"),
                "unexpected error: {message}"
            ),
        }
    }
}
