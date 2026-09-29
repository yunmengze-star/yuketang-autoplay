// ==UserScript==
// @name         雨课堂自动连续播放
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  新版雨课堂自动连续播放：视频结束后自动进入下一个视频，支持 SPA 页面切换与自定义播放倍速。
// @author       YourName
// @license      MIT
// @match        https://*.yuketang.cn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    /**
     * ============================================================
     * 用户配置
     * ============================================================
     */
    const CONFIG = Object.freeze({

        /**
         * 播放倍速
         *
         * 1.0 = 正常速度（默认）
         * 1.25 = 1.25 倍
         * 1.5 = 1.5 倍
         * 2.0 = 2 倍
         *
         * 如果需要 2 倍速：
         *
         * playbackRate: 2.0,
         *
         * 注意：
         * 是否允许倍速、是否记录倍速由课程和平台规则决定。
         */
        playbackRate: 1.0,

        /**
         * 进入视频页面后是否尝试自动播放。
         *
         * 浏览器可能会阻止首次“有声音自动播放”。
         * 一旦用户与网页进行过真实交互，后续通常可以正常连续播放。
         */
        autoPlay: true,

        /**
         * 视频结束后等待多久再进入下一视频。
         *
         * 不建议设置成 0。
         * 留几秒时间可以让页面正常提交播放完成状态。
         */
        nextDelayMs: 3000,

        /**
         * 距离视频结尾多少秒时视为播放结束。
         *
         * 这是 ended 事件没有正常触发时的备用机制。
         */
        endToleranceSec: 0.35,

        /**
         * 页面状态检查间隔。
         *
         * 用于兼容雨课堂 SPA 页面切换、DOM 动态更新等情况。
         */
        scanIntervalMs: 1500,

        /**
         * 是否输出调试信息。
         *
         * 如果脚本已经稳定运行，可以改成 false。
         */
        debug: true
    });


    /**
     * ============================================================
     * 页面选择器
     * ============================================================
     *
     * 集中放在这里，未来雨课堂改版时只需要修改这里，
     * 不需要改整个脚本。
     */
    const SELECTORS = Object.freeze({

        // 当前视频
        video: [
            'video.xt_video_player',
            '#video-box video',
            '.xt_video_player_container video',
            'video'
        ].join(','),

        // 左侧课程目录中的所有学习单元
        leaf: '.leaf-item',

        // 当前正在学习的目录项
        activeLeaf: '.leaf-item.is-active',

        // 学习单元类型，例如“视频”“作业”
        leafTag: '.leaf-item-tag',

        // 学习单元标题
        leafTitle: '.leaf-item-title',

        // 当前页面上方显示的课程标题
        currentTitle: '.unit-title'
    });


    /**
     * ============================================================
     * 运行状态
     * ============================================================
     */
    const state = {

        // 当前 URL
        href: location.href,

        // 当前 video DOM
        video: null,

        // 当前视频源
        videoSrc: '',

        // 当前视频事件控制器
        eventController: null,

        // 当前视频是否已经真正开始播放
        hasStarted: false,

        // 是否已经触发“下一视频”
        nextScheduled: false,

        // MutationObserver 的防抖计时器
        scanTimer: null,

        // 是否正在等待用户交互后重新尝试自动播放
        gestureRetryInstalled: false
    };


    /**
     * ============================================================
     * 日志
     * ============================================================
     */
    function log(...args) {

        if (!CONFIG.debug) {
            return;
        }

        console.log(
            '%c[雨课堂助手]',
            'color:#4182FA;font-weight:bold;',
            ...args
        );
    }


    function warn(...args) {

        console.warn(
            '[雨课堂助手]',
            ...args
        );
    }


    /**
     * ============================================================
     * 文本工具
     * ============================================================
     */
    function normalizeText(text) {

        return String(text ?? '')
            .replace(/\s+/g, ' ')
            .trim();
    }


    /**
     * ============================================================
     * 获取课程目录
     * ============================================================
     */
    function getLeaves() {

        return Array.from(
            document.querySelectorAll(
                SELECTORS.leaf
            )
        );
    }


    /**
     * 获取目录项标题
     */
    function getLeafTitle(leaf) {

        if (!leaf) {
            return '';
        }

        const title =
            leaf.querySelector(
                SELECTORS.leafTitle
            );

        return normalizeText(
            title?.textContent
        );
    }


    /**
     * 获取目录项类型
     *
     * 例如：
     *
     * 视频
     * 作业
     * 课件
     */
    function getLeafType(leaf) {

        if (!leaf) {
            return '';
        }

        const tag =
            leaf.querySelector(
                SELECTORS.leafTag
            );

        return normalizeText(
            tag?.textContent
        );
    }


    /**
     * ============================================================
     * 寻找当前课程
     * ============================================================
     */
    function getActiveLeaf() {

        /**
         * 第一方案：
         * 使用 is-active。
         *
         * 当前页面正常情况下应该使用这个方法。
         */
        const active =
            document.querySelector(
                SELECTORS.activeLeaf
            );

        if (active) {
            return active;
        }


        /**
         * 第二方案：
         *
         * 某些 SPA 切换瞬间，
         * is-active 可能还没有来得及添加。
         *
         * 此时通过页面顶部课程标题进行匹配。
         */
        const currentTitle =
            normalizeText(
                document.querySelector(
                    SELECTORS.currentTitle
                )?.textContent
            );

        if (!currentTitle) {
            return null;
        }

        return (
            getLeaves().find(
                leaf =>
                    getLeafTitle(leaf) ===
                    currentTitle
            ) ?? null
        );
    }


    /**
     * ============================================================
     * 寻找下一个视频
     * ============================================================
     */
    function getNextVideoLeaf() {

        const leaves = getLeaves();

        if (!leaves.length) {

            log('暂时没有找到课程目录');

            return null;
        }


        const active = getActiveLeaf();

        if (!active) {

            log(
                '暂时没有识别到当前课程'
            );

            return null;
        }


        const currentIndex =
            leaves.indexOf(active);

        if (currentIndex === -1) {

            log(
                '当前课程不在目录列表中'
            );

            return null;
        }


        log(
            '当前课程：',
            getLeafTitle(active)
        );


        /**
         * 从当前项目后面开始寻找。
         *
         * 只找“视频”。
         *
         * 所以：
         *
         * 视频
         * ↓
         * 作业
         * ↓
         * 视频
         *
         * 会自动跳过中间的作业。
         */
        for (
            let i = currentIndex + 1;
            i < leaves.length;
            i++
        ) {

            const leaf = leaves[i];

            /**
             * 跳过明显不可用的节点
             */
            if (
                leaf.matches(
                    '.disabled,' +
                    '.is-disabled,' +
                    '[aria-disabled="true"]'
                )
            ) {
                continue;
            }


            const type =
                getLeafType(leaf);

            if (type === '视频') {

                log(
                    '找到下一个视频：',
                    getLeafTitle(leaf)
                );

                return leaf;
            }
        }


        return null;
    }


    /**
     * ============================================================
     * 播放倍速
     * ============================================================
     */
    function applyPlaybackRate(video) {

        const rate =
            Number(
                CONFIG.playbackRate
            );


        /**
         * 防止配置写错。
         */
        if (
            !Number.isFinite(rate) ||
            rate <= 0
        ) {

            warn(
                '播放倍速配置无效：',
                CONFIG.playbackRate
            );

            return;
        }


        try {

            video.defaultPlaybackRate =
                rate;

            video.playbackRate =
                rate;


            log(
                `播放速度设置为 ${rate}x`
            );

        } catch (error) {

            warn(
                '设置播放速度失败',
                error
            );
        }
    }


    /**
     * ============================================================
     * 自动播放
     * ============================================================
     */
    async function tryAutoPlay(video) {

        if (
            !CONFIG.autoPlay ||
            !video ||
            video.ended ||
            !video.paused
        ) {
            return;
        }


        try {

            await video.play();

            log(
                '自动播放成功'
            );

        } catch (error) {

            /**
             * Chrome / Edge：
             *
             * 页面没有发生真实用户操作之前，
             * 有声视频可能禁止自动播放。
             *
             * 这里不会疯狂重复调用 play()。
             */
            if (
                error?.name ===
                'NotAllowedError'
            ) {

                log(
                    '浏览器暂时阻止自动播放，等待下一次用户页面交互'
                );

                installGestureRetry();

                return;
            }


            log(
                '自动播放暂时失败：',
                error
            );
        }
    }


    /**
     * ============================================================
     * 浏览器首次自动播放限制
     * ============================================================
     *
     * 用户只要正常点击一下网页或按一下键盘，
     * 就会再次尝试播放。
     *
     * 不需要专门点击脚本按钮。
     */
    function installGestureRetry() {

        if (
            state.gestureRetryInstalled
        ) {
            return;
        }


        state.gestureRetryInstalled =
            true;


        const retry = () => {

            cleanup();

            if (
                state.video &&
                state.video.paused &&
                !state.video.ended
            ) {

                tryAutoPlay(
                    state.video
                );
            }
        };


        const cleanup = () => {

            state.gestureRetryInstalled =
                false;

            window.removeEventListener(
                'pointerdown',
                retry,
                true
            );

            window.removeEventListener(
                'keydown',
                retry,
                true
            );
        };


        window.addEventListener(
            'pointerdown',
            retry,
            true
        );

        window.addEventListener(
            'keydown',
            retry,
            true
        );
    }


    /**
     * ============================================================
     * 自动进入下一视频
     * ============================================================
     */
    function scheduleNextVideo(
        video,
        reason
    ) {

        /**
         * 防止：
         *
         * ended
         *
         * 和
         *
         * timeupdate
         *
         * 同时触发导致一次跳两个视频。
         */
        if (
            state.nextScheduled ||
            video !== state.video
        ) {
            return;
        }


        state.nextScheduled = true;


        const pageAtEnd =
            location.href;


        log(
            `视频播放结束 (${reason})`
        );


        log(
            `${CONFIG.nextDelayMs / 1000} 秒后进入下一视频`
        );


        window.setTimeout(
            () => {

                /**
                 * 等待期间用户自己切换了页面，
                 * 那么取消原来的自动跳转。
                 */
                if (
                    video !== state.video ||
                    location.href !==
                        pageAtEnd
                ) {

                    log(
                        '页面已经发生变化，取消本次自动跳转'
                    );

                    return;
                }


                const next =
                    getNextVideoLeaf();


                if (!next) {

                    state.nextScheduled =
                        false;

                    log(
                        '没有找到后续视频，可能已经播放到课程末尾'
                    );

                    return;
                }


                const nextTitle =
                    getLeafTitle(next);


                log(
                    '准备进入：',
                    nextTitle
                );


                /**
                 * 滚动到目标。
                 *
                 * 即使左侧目录滚动较远，
                 * 也可以正常定位。
                 */
                try {

                    next.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                        inline: 'nearest'
                    });

                } catch {
                    // scrollIntoView 失败不会影响点击
                }


                window.setTimeout(
                    () => {

                        /**
                         * 再次检查：
                         * 防止滚动期间用户手动换课。
                         */
                        if (
                            video !==
                                state.video ||
                            location.href !==
                                pageAtEnd
                        ) {
                            return;
                        }


                        /**
                         * Vue 页面通常直接监听
                         * .leaf-item 的 click。
                         */
                        next.click();


                        log(
                            '已点击下一视频：',
                            nextTitle
                        );

                    },
                    300
                );

            },
            CONFIG.nextDelayMs
        );
    }


    /**
     * ============================================================
     * 绑定视频事件
     * ============================================================
     */
    function bindVideo(video) {

        /**
         * 移除旧 video 上的监听器。
         *
         * AbortController 可以避免 SPA 多次切换之后
         * 出现越来越多的重复事件。
         */
        state.eventController?.abort();


        const controller =
            new AbortController();


        state.eventController =
            controller;

        state.video =
            video;

        state.videoSrc =
            video.currentSrc ||
            video.src ||
            '';

        state.hasStarted =
            false;

        state.nextScheduled =
            false;


        const signal =
            controller.signal;


        log(
            '绑定视频：',
            state.videoSrc ||
            video
        );


        /**
         * 设置播放速度。
         */
        applyPlaybackRate(video);


        /**
         * metadata 加载完成以后再设置一次。
         *
         * 某些播放器在加载视频时可能重置 playbackRate。
         */
        video.addEventListener(
            'loadedmetadata',
            () => {
                applyPlaybackRate(video);
            },
            {
                signal
            }
        );


        /**
         * 视频真正开始播放。
         */
        video.addEventListener(
            'play',
            () => {

                state.hasStarted =
                    true;

                log(
                    '视频开始播放'
                );
            },
            {
                signal
            }
        );


        /**
         * 主判断：
         * HTML5 标准 ended 事件。
         */
        video.addEventListener(
            'ended',
            () => {

                scheduleNextVideo(
                    video,
                    'ended'
                );

            },
            {
                signal
            }
        );


        /**
         * 备用判断。
         *
         * 某些播放器封装情况下，
         * ended 偶尔可能不触发。
         *
         * 必须确认本次视频真正播放过，
         * 防止打开一个已经在末尾的视频时直接跳走。
         */
        video.addEventListener(
            'timeupdate',
            () => {

                if (
                    !state.hasStarted ||
                    state.nextScheduled
                ) {
                    return;
                }


                const duration =
                    video.duration;

                const current =
                    video.currentTime;


                if (
                    !Number.isFinite(
                        duration
                    ) ||
                    duration <= 0
                ) {
                    return;
                }


                if (
                    current >=
                    duration -
                    CONFIG.endToleranceSec
                ) {

                    scheduleNextVideo(
                        video,
                        'timeupdate'
                    );
                }

            },
            {
                signal
            }
        );


        /**
         * 自动播放只尝试一次。
         *
         * 不会在用户主动暂停之后
         * 一遍又一遍强制重新播放。
         */
        let autoPlayAttempted =
            false;


        const initialAutoPlay =
            () => {

                if (
                    autoPlayAttempted
                ) {
                    return;
                }

                autoPlayAttempted =
                    true;

                tryAutoPlay(video);
            };


        if (
            video.readyState >= 2
        ) {

            window.setTimeout(
                initialAutoPlay,
                300
            );

        } else {

            video.addEventListener(
                'canplay',
                initialAutoPlay,
                {
                    once: true,
                    signal
                }
            );
        }
    }


    /**
     * ============================================================
     * 检测当前页面
     * ============================================================
     */
    function scanPage() {

        /**
         * 雨课堂使用 SPA。
         *
         * 页面变化时不一定真正刷新浏览器，
         * 因此不能只依赖 userscript 第一次启动。
         */
        if (
            location.href !==
            state.href
        ) {

            state.href =
                location.href;

            state.nextScheduled =
                false;

            state.hasStarted =
                false;


            log(
                '页面切换：',
                state.href
            );
        }


        const video =
            document.querySelector(
                SELECTORS.video
            );


        if (!video) {
            return;
        }


        const src =
            video.currentSrc ||
            video.src ||
            '';


        /**
         * 情况 1：
         * 新页面创建了新的 <video>。
         */
        if (
            video !==
            state.video
        ) {

            bindVideo(video);

            return;
        }


        /**
         * 情况 2：
         *
         * Vue 没有创建新的 video，
         * 而是复用了同一个 DOM，
         * 只修改了 src。
         *
         * 这种情况也需要重新初始化。
         */
        if (
            src &&
            src !==
            state.videoSrc
        ) {

            log(
                '检测到视频源发生变化'
            );

            bindVideo(video);
        }
    }


    /**
     * ============================================================
     * DOM 变化监听
     * ============================================================
     *
     * MutationObserver：
     *
     * 新视频一插入 DOM，
     * 可以快速发现。
     *
     * 不需要一直高频 setInterval。
     */
    const observer =
        new MutationObserver(
            () => {

                if (
                    state.scanTimer
                ) {
                    return;
                }


                state.scanTimer =
                    window.setTimeout(
                        () => {

                            state.scanTimer =
                                null;

                            scanPage();

                        },
                        150
                    );
            }
        );


    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true,

            /**
             * SPA 可能复用 video 并修改 src。
             */
            attributes: true,
            attributeFilter: [
                'src',
                'class'
            ]
        }
    );


    /**
     * ============================================================
     * 备用定时检查
     * ============================================================
     *
     * MutationObserver 为主，
     * setInterval 为兜底。
     *
     * 即使雨课堂内部以后修改部分 DOM 更新方式，
     * 仍有机会发现新视频。
     */
    const interval =
        window.setInterval(
            scanPage,
            CONFIG.scanIntervalMs
        );


    /**
     * 页面从后台恢复时检查一次。
     */
    document.addEventListener(
        'visibilitychange',
        () => {

            if (
                document.visibilityState ===
                'visible'
            ) {

                scanPage();
            }
        }
    );


    /**
     * BFCache 恢复。
     */
    window.addEventListener(
        'pageshow',
        scanPage
    );


    /**
     * 页面销毁时清理。
     */
    window.addEventListener(
        'pagehide',
        () => {

            observer.disconnect();

            window.clearInterval(
                interval
            );

            state.eventController
                ?.abort();
        },
        {
            once: true
        }
    );


    /**
     * ============================================================
     * 启动
     * ============================================================
     */
    log(
        '脚本启动',
        `v3.0.0 | ${CONFIG.playbackRate}x`
    );


    scanPage();

})();
