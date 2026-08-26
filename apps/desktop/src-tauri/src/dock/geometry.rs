//! Task Dock の配置計算。UI/UX §4.2。
//!
//! ここは純粋な算術だけにしてある。window を触る処理と混ぜると
//! GUI 無しでは一切検証できなくなるため。

pub use super::geometry_generated::{
    DockSize, DockState, BOTTOM_OFFSET_DEFAULT, BOTTOM_OFFSET_MAX, BOTTOM_OFFSET_MIN, EDGE_MARGIN,
};

/// 作業領域。メニューバーやタスクバーを除いた、実際に置ける範囲。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

fn clamp(value: i32, min: i32, max: i32) -> i32 {
    value.min(max).max(min)
}

/// 既定位置。primary display の下部中央、下端から 48–72px（§4.2）。
///
/// 作業領域が Dock より狭い場合でも画面外へは出さない。
/// 一度画面外へ出すと、ユーザーは二度と掴めない。
pub fn default_position(work_area: Rect, width: i32, height: i32, bottom_offset: i32) -> Position {
    let offset = clamp(bottom_offset, BOTTOM_OFFSET_MIN, BOTTOM_OFFSET_MAX);

    let centered = work_area.x + (work_area.width - width) / 2;
    let min_x = work_area.x + EDGE_MARGIN;
    let max_x = work_area.x + work_area.width - width - EDGE_MARGIN;
    let x = clamp(centered, min_x.min(max_x), min_x.max(max_x));

    let desired_y = work_area.y + work_area.height - height - offset;
    let max_y = work_area.y + work_area.height - height;
    let y = clamp(desired_y, work_area.y, work_area.y.max(max_y));

    Position { x, y }
}

/// ユーザーが動かした位置を、その display の作業領域内へ収める（§4.2）。
pub fn clamp_to_work_area(
    position: Position,
    work_area: Rect,
    width: i32,
    height: i32,
) -> Position {
    let max_x = work_area.x + work_area.width - width;
    let max_y = work_area.y + work_area.height - height;
    Position {
        x: clamp(position.x, work_area.x, work_area.x.max(max_x)),
        y: clamp(position.y, work_area.y, work_area.y.max(max_y)),
    }
}

/// 内容の行数から高さを決める。min..=max に収める（§4.1）。
pub fn height_for(state: DockState, content_height: u32) -> u32 {
    let size = state.size();
    content_height.clamp(size.min_height, size.max_height)
}

/// 表示先の display を選ぶ。§4.2「最後に操作した display に出す」。
///
/// 覚えている display が既に無ければ primary へ戻す。
/// 外部ディスプレイを抜いた直後に「見えない場所へ出す」ことを避ける。
pub fn pick_display(available: &[u32], last_used: Option<u32>, primary: u32) -> u32 {
    match last_used {
        Some(id) if available.contains(&id) => id,
        _ => primary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FHD: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn centers_horizontally_on_the_work_area() {
        let p = default_position(FHD, 560, 56, BOTTOM_OFFSET_DEFAULT);
        assert_eq!(p.x, (1920 - 560) / 2);
    }

    #[test]
    fn sits_between_48_and_72_px_from_the_bottom() {
        for requested in [0, 48, 56, 72, 500] {
            let p = default_position(FHD, 560, 56, requested);
            let gap = FHD.height - (p.y + 56);
            assert!(
                (BOTTOM_OFFSET_MIN..=BOTTOM_OFFSET_MAX).contains(&gap),
                "gap {gap} outside the spec range for requested {requested}"
            );
        }
    }

    #[test]
    fn respects_a_work_area_that_does_not_start_at_zero() {
        // macOS のメニューバー分だけ下がった作業領域
        let work = Rect {
            x: 0,
            y: 25,
            width: 1920,
            height: 1055,
        };
        let p = default_position(work, 560, 56, BOTTOM_OFFSET_DEFAULT);
        assert!(p.y >= work.y);
        assert!(p.y + 56 <= work.y + work.height);
    }

    #[test]
    fn stays_on_screen_when_the_work_area_is_smaller_than_the_dock() {
        let tiny = Rect {
            x: 0,
            y: 0,
            width: 400,
            height: 200,
        };
        let p = default_position(tiny, 560, 56, BOTTOM_OFFSET_DEFAULT);
        // 画面外へ出さない。掴めなくなるより、はみ出して見える方がまし。
        assert!(p.x >= tiny.x - 560);
        assert!(p.y >= tiny.y);
    }

    #[test]
    fn positions_on_a_secondary_display_using_its_own_origin() {
        let secondary = Rect {
            x: 1920,
            y: 0,
            width: 2560,
            height: 1440,
        };
        let p = default_position(secondary, 560, 56, BOTTOM_OFFSET_DEFAULT);
        assert!(p.x >= secondary.x);
        assert!(p.x + 560 <= secondary.x + secondary.width);
    }

    #[test]
    fn pulls_a_dragged_dock_back_inside_the_work_area() {
        let far = Position { x: 9999, y: -500 };
        let p = clamp_to_work_area(far, FHD, 560, 56);
        assert_eq!(p.x, 1920 - 560);
        assert_eq!(p.y, 0);
    }

    #[test]
    fn leaves_a_dragged_dock_alone_when_it_is_already_inside() {
        let inside = Position { x: 100, y: 200 };
        assert_eq!(clamp_to_work_area(inside, FHD, 560, 56), inside);
    }

    #[test]
    fn ready_uses_the_size_the_spec_fixes() {
        let size = DockState::Ready.size();
        assert_eq!(
            (size.width, size.min_height, size.max_height),
            (560, 56, 56)
        );
    }

    #[test]
    fn typing_grows_only_within_its_range() {
        assert_eq!(height_for(DockState::Typing, 40), 96);
        assert_eq!(height_for(DockState::Typing, 120), 120);
        assert_eq!(height_for(DockState::Typing, 400), 140);
    }

    #[test]
    fn falls_back_to_primary_when_the_remembered_display_is_gone() {
        assert_eq!(pick_display(&[1, 2], Some(2), 1), 2);
        // 外部ディスプレイを抜いた直後に、見えない場所へ出さない
        assert_eq!(pick_display(&[1], Some(2), 1), 1);
        assert_eq!(pick_display(&[1, 2], None, 1), 1);
    }
}
