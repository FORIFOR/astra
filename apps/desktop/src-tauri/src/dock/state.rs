//! Dock の位置記憶。UI/UX §4.2「ユーザーが Dock を移動した場合はその display 内で位置を記憶」。

use std::collections::HashMap;

use super::geometry::Position;

#[derive(Debug, Default)]
pub struct DockPlacementMemory {
    by_display: HashMap<u32, Position>,
    last_display: Option<u32>,
}

impl DockPlacementMemory {
    pub fn remember(&mut self, display_id: u32, position: Position) {
        self.by_display.insert(display_id, position);
        self.last_display = Some(display_id);
    }

    pub fn remembered(&self, display_id: u32) -> Option<Position> {
        self.by_display.get(&display_id).copied()
    }

    /// §4.2「multi-monitor では最後に操作した display に出す」。
    pub fn last_display(&self) -> Option<u32> {
        self.last_display
    }

    /// 接続が無くなった display の記憶を捨てる。
    /// 残しておくと、繋ぎ直すまで「見えない場所」を復元し続ける。
    pub fn forget_missing(&mut self, available: &[u32]) {
        self.by_display.retain(|id, _| available.contains(id));
        if let Some(last) = self.last_display {
            if !available.contains(&last) {
                self.last_display = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_a_position_per_display() {
        let mut memory = DockPlacementMemory::default();
        memory.remember(1, Position { x: 10, y: 20 });
        memory.remember(2, Position { x: 30, y: 40 });

        assert_eq!(memory.remembered(1), Some(Position { x: 10, y: 20 }));
        assert_eq!(memory.remembered(2), Some(Position { x: 30, y: 40 }));
        assert_eq!(memory.remembered(3), None);
    }

    #[test]
    fn tracks_the_display_the_user_last_touched() {
        let mut memory = DockPlacementMemory::default();
        assert_eq!(memory.last_display(), None);
        memory.remember(1, Position { x: 0, y: 0 });
        memory.remember(2, Position { x: 0, y: 0 });
        assert_eq!(memory.last_display(), Some(2));
    }

    #[test]
    fn drops_displays_that_went_away() {
        let mut memory = DockPlacementMemory::default();
        memory.remember(1, Position { x: 0, y: 0 });
        memory.remember(2, Position { x: 0, y: 0 });

        memory.forget_missing(&[1]);
        assert_eq!(memory.remembered(2), None);
        // 見えない display を「最後に使った場所」として復元し続けない
        assert_eq!(memory.last_display(), None);
        assert!(memory.remembered(1).is_some());
    }
}
