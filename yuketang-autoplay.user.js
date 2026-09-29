// ==UserScript==
// @name         雨课堂自动连续播放
// @name:zh-CN   雨课堂自动连续播放
// @namespace    https://github.com/yunmengze-star/yuketang-autoplay
// @version      3.0.0
// @description  新版雨课堂自动连续播放：当前视频正常播放结束后，自动寻找并进入下一个视频。支持 SPA 页面、自定义倍速、重复触发保护和异常恢复。
// @description:zh-CN 新版雨课堂自动连续播放：当前视频正常播放结束后，自动寻找并进入下一个视频。支持 SPA 页面、自定义倍速、重复触发保护和异常恢复。
// @author       yunmengze-star
// @license      MIT
//
// @homepageURL  https://github.com/yunmengze-star/yuketang-autoplay
// @supportURL   https://github.com/yunmengze-star/yuketang-autoplay/issues
//
// @updateURL    https://raw.githubusercontent.com/yunmengze-star/yuketang-autoplay/main/yuketang-autoplay.user.js
// @downloadURL  https://raw.githubusercontent.com/yunmengze-star/yuketang-autoplay/main/yuketang-autoplay.user.js
//
// @match        https://*.yuketang.cn/ai-workspace/lms-graph/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    /**
     * ============================================================
     *  雨课堂自动连续播放
     *  Yuketang Autoplay
     * ============================================================
     *
     * GitHub:
     * https://github.com/yunmengze-star/yuketang-autoplay
     *
     * 主要功能：
     *
     * 1. 自动识别当前视频播放器
     * 2. 当前视频真正播放结束后自动进入下一个视频
     * 3. 自动跳过“作业”等非视频学习单元
     * 4. 支持新版雨课堂 SPA 页面
     * 5. 支持同一个 <video> 元素动态更换视频源
     * 6. 防止 ended/timeupdate 重复触发导致连续跳过多个视频
     * 7. 支持自定义播放倍速
     * 8. 尽可能自动播放下一视频
     * 9. 等待当前视频完成状态提交后再切换
     *
     * 本脚本不会：
     *
     * - 修改课程完成度
     * - 伪造视频完成状态
     * - 自动拖动进度条
     * - 自动完成作业
     * - 自动答题
     *
     * 它只是在视频正常播放结束后自动切换到下一视频。
     */


    /* ============================================================
     * 用户配置
     * ============================================================ */

    const CONFIG = Object.freeze({

        /**
         * 播放倍速
         *
         * 默认：
         *
         *     1.0
         *
         * 即正常 1 倍速。
         *
         * 如果想修改：
         *
         * 1.25 倍：
         *     playbackRate: 1.25,
         *
         * 1.5 倍：
         *     playbackRate: 1.5,
         *
         * 2 倍：
         *     playbackRate: 2.0,
         *
         * 修改这里即可，其他代码不用动。
         *
         * 注意：
         * 是否允许使用倍速，以及平台是否记录播放倍速，
         * 由具体课程和雨课堂平台规则决定。
         */
        playbackRate: 1.0,


        /**
         * 是否尝试自动播放。
         *
         * true：
         *     进入下一视频后尝试自动播放。
         *
         * false：
         *     只自动切换视频，不自动调用 play()。
         */
        autoPlay: true,


        /**
         * 视频结束后最少等待时间。
         *
         * 默认 3000 ms = 3 秒。
         *
         * 不建议设置为 0。
         *
         * 留出一点时间，可以让雨课堂正常提交
         * 当前视频的观看状态。
         */
        nextDelayMs: 3000,


        /**
         * 等待雨课堂显示“已完成”的最长时间。
         *
         * 默认最多等待 10 秒。
         *
         * 如果 10 秒后仍未显示“已完成”，
         * 脚本仍然会继续进入下一视频。
         */
        completionWaitMaxMs: 10000,


        /**
         * 检查“已完成”状态的间隔。
         */
        completionCheckIntervalMs: 500,


        /**
         * 视频距离最后多少秒时，
         * 可以作为 ended 事件的备用结束判断。
         *
         * 默认 0.35 秒。
         */
        endToleranceSec: 0.35,


        /**
         * SPA 页面备用扫描间隔。
         *
         * MutationObserver 是主要机制，
         * 定时扫描只是兜底。
         */
        scanIntervalMs: 1500,


        /**
         * 是否在 F12 Console 输出调试日志。
         *
         * true：
         *     输出运行过程。
         *
         * false：
         *     安静运行。
         *
         * 推荐刚安装时保持 true。
         * 稳定以后可以修改成 false。
         */
        debug: true
    });


    /* ============================================================
     * 页面选择器
     * ============================================================
     *
     * 未来如果雨课堂修改页面结构，
     * 优先检查并修改这里。
     *
     * 将选择器集中保存，避免散落在整个脚本中。
     */

    const SELECTORS = Object.freeze({

        /**
         * 视频播放器。
         *
         * 第一项是当前新版雨课堂实际使用的播放器。
         *
         * 后面几个是备用选择器。
         */
        video: [
            'video.xt_video_player',
            '#video-box video',
            '.xt_video_player_container video',
            'video'
        ].join(','),


        /**
         * 左侧课程目录中的每一个学习单元。
         */
        leaf: '.leaf-item',


        /**
         * 当前正在学习的项目。
         */
        activeLeaf: '.leaf-item.is-active',


        /**
         * 项目类型。
         *
         * 例如：
         *
         * 视频
         * 作业
         */
        leafTag: '.leaf-item-tag',


        /**
         * 项目标题。
         */
        leafTitle: '.leaf-item-title',


        /**
         * 页面播放器上方显示的当前课程标题。
         *
         * 当 .is-active 暂时没有更新时，
         * 可以作为备用识别方式。
         */
        currentTitle: '.unit-title',


        /**
         * 当前学习单元完成状态。
         *
         * 当前页面通常会显示：
         *
         * 已完成
         */
        completionText:
            '.learning-space-control-unit .rate-detail .text'
    });


    /* ============================================================
     * 运行状态
     * ============================================================ */

    const state = {

        /**
         * 当前 URL。
         */
        href: window.location.href,


        /**
         * 当前绑定的 <video>。
         */
        video: null,


        /**
         * 当前视频源。
         *
         * 雨课堂可能复用同一个 <video> DOM，
         * 只修改 src，因此需要单独记录。
         */
        videoSrc: '',


        /**
         * 当前视频事件 AbortController。
         *
         * 换视频时可以一次性解除旧事件监听。
         */
        eventController: null,


        /**
         * 本视频是否真正开始播放过。
         */
        hasStarted: false,


        /**
         * 是否已经安排进入下一视频。
         *
         * 防止：
         *
         * ended
         *
         * +
         *
         * timeupdate
         *
         * 同时触发。
         */
        nextScheduled: false,


        /**
         * DOM Observer 防抖。
         */
        scanTimer: null,


        /**
         * 是否已经安装用户交互后的自动播放重试。
         */
        gestureRetryInstalled: false
    };


    /* ============================================================
     * 日志工具
     * ============================================================ */

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


    /* ============================================================
     * 基础工具
     * ============================================================ */

    function normalizeText(text) {

        return String(text ?? '')
            .replace(/\s+/g, ' ')
            .trim();
    }


    function sleep(ms) {

        return new Promise(resolve => {
            window.setTimeout(resolve, ms);
        });
    }


    /* ============================================================
     * 获取课程目录
     * ============================================================ */

    function getLeaves() {

        return Array.from(
            document.querySelectorAll(
                SELECTORS.leaf
            )
        );
    }


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


    /* ============================================================
     * 获取当前课程
     * ============================================================ */

    function getActiveLeaf() {

        /**
         * 正常情况：
         *
         * 当前课程带：
         *
         * .leaf-item.is-active
         */
        const active =
            document.querySelector(
                SELECTORS.activeLeaf
            );

        if (active) {
            return active;
        }


        /**
         * SPA 页面切换过程中，
         * is-active 偶尔可能尚未更新。
         *
         * 这时尝试使用播放器上方标题匹配。
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


    /* ============================================================
     * 查找下一个视频
     * ============================================================ */

    function getNextVideoLeaf() {

        const leaves = getLeaves();

        if (!leaves.length) {

            log(
                '暂时没有找到课程目录'
            );

            return null;
        }


        const active = getActiveLeaf();

        if (!active) {

            log(
                '暂时没有找到当前激活课程'
            );

            return null;
        }


        const currentIndex =
            leaves.indexOf(active);


        if (currentIndex < 0) {

            log(
                '当前课程不在课程目录列表中'
            );

            return null;
        }


        log(
            '当前课程：',
            getLeafTitle(active)
        );


        /**
         * 从当前学习单元后面开始搜索。
         *
         * 只选择类型为“视频”的项目。
         *
         * 例如：
         *
         * 视频 A
         * ↓
         * 作业
         * ↓
         * 视频 B
         *
         * 视频 A 播完以后，
         * 会直接进入视频 B。
         */
        for (
            let i = currentIndex + 1;
            i < leaves.length;
            i++
        ) {

            const leaf =
                leaves[i];


            /**
             * 跳过明显禁用的项目。
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
                    '下一个视频：',
                    getLeafTitle(leaf)
                );

                return leaf;
            }
        }


        return null;
    }


    /* ============================================================
     * 播放倍速
     * ============================================================ */

    function applyPlaybackRate(video) {

        if (!video) {
            return;
        }


        const rate =
            Number(
                CONFIG.playbackRate
            );


        /**
         * 防止用户把配置误写成：
         *
         * playbackRate: "abc"
         *
         * 或：
         *
         * playbackRate: 0
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


            if (
                Math.abs(
                    video.playbackRate -
                    rate
                ) > 0.01
            ) {

                video.playbackRate =
                    rate;
            }


            log(
                `播放速度：${rate}x`
            );

        } catch (error) {

            warn(
                '设置播放倍速失败：',
                error
            );
        }
    }


    /* ============================================================
     * 自动播放
     * ============================================================ */

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
             * Chrome / Edge 等浏览器会限制
             * 没有用户交互时的有声自动播放。
             *
             * 浏览器策略无法由普通 userscript
             * 可靠地强行绕过。
             */
            if (
                error?.name ===
                'NotAllowedError'
            ) {

                log(
                    '浏览器暂时阻止自动播放，等待用户第一次正常操作页面'
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


    /* ============================================================
     * 用户第一次操作页面后重试播放
     * ============================================================ */

    function installGestureRetry() {

        if (
            state.gestureRetryInstalled
        ) {
            return;
        }


        state.gestureRetryInstalled =
            true;


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


        const retry = () => {

            cleanup();


            const video =
                state.video;


            if (
                video &&
                video.paused &&
                !video.ended
            ) {

                tryAutoPlay(video);
            }
        };


        /**
         * 用户正常点击页面或者按键以后，
         * 自动再尝试一次。
         *
         * 不需要额外点击脚本自己的按钮。
         */
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


    /* ============================================================
     * 当前学习单元是否显示“已完成”
     * ============================================================ */

    function isCurrentUnitCompleted() {

        const element =
            document.querySelector(
                SELECTORS.completionText
            );


        const text =
            normalizeText(
                element?.textContent
            );


        return (
            text.includes('已完成')
        );
    }


    /* ============================================================
     * 等待课程完成状态提交
     * ============================================================ */

    async function waitForCompletion() {

        /**
         * 如果已经显示“已完成”，
         * 无需继续等待。
         */
        if (
            isCurrentUnitCompleted()
        ) {

            log(
                '当前视频状态已经显示“已完成”'
            );

            return true;
        }


        const start =
            Date.now();


        log(
            '等待雨课堂提交当前视频完成状态'
        );


        while (
            Date.now() - start <
            CONFIG.completionWaitMaxMs
        ) {

            await sleep(
                CONFIG.completionCheckIntervalMs
            );


            if (
                isCurrentUnitCompleted()
            ) {

                log(
                    '检测到“已完成”状态'
                );

                return true;
            }
        }


        /**
         * 超时也继续。
         *
         * 避免页面状态显示异常导致脚本永远卡死。
         */
        log(
            '等待完成状态超时，继续执行下一视频'
        );


        return false;
    }


    /* ============================================================
     * 点击课程目录项
     * ============================================================ */

    function clickLeaf(leaf) {

        if (!leaf) {
            return false;
        }


        try {

            /**
             * 如果目标不在当前可视区域，
             * 先滚动到附近。
             */
            leaf.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });

        } catch {
            // 滚动失败不影响后续点击
        }


        /**
         * 原生 click 会生成正常的冒泡 click 事件，
         * Vue 的监听器通常可以正常收到。
         */
        leaf.click();


        return true;
    }


    /* ============================================================
     * 视频结束 → 下一视频
     * ============================================================ */

    async function scheduleNextVideo(
        video,
        reason
    ) {

        /**
         * 防止重复触发。
         */
        if (
            state.nextScheduled ||
            video !== state.video
        ) {

            return;
        }


        state.nextScheduled =
            true;


        const pageAtEnd =
            window.location.href;


        log(
            `检测到视频播放结束，来源：${reason}`
        );


        /**
         * 先至少等待配置中的时间。
         */
        if (
            CONFIG.nextDelayMs > 0
        ) {

            log(
                `${CONFIG.nextDelayMs / 1000} 秒后检查下一视频`
            );


            await sleep(
                CONFIG.nextDelayMs
            );
        }


        /**
         * 用户可能已经自己切换了课程。
         *
         * 如果发生这种情况，
         * 取消旧任务。
         */
        if (
            video !== state.video ||
            window.location.href !==
                pageAtEnd
        ) {

            log(
                '页面已经发生变化，取消旧的自动跳转'
            );

            return;
        }


        /**
         * 等待雨课堂提交当前视频完成状态。
         */
        await waitForCompletion();


        /**
         * 等待过程中用户仍然可能手动切换。
         */
        if (
            video !== state.video ||
            window.location.href !==
                pageAtEnd
        ) {

            log(
                '页面已经发生变化，取消自动跳转'
            );

            return;
        }


        const next =
            getNextVideoLeaf();


        if (!next) {

            state.nextScheduled =
                false;


            log(
                '没有找到后续视频，可能已经到达本课程最后一个视频'
            );


            return;
        }


        const nextTitle =
            getLeafTitle(next);


        log(
            '准备进入下一视频：',
            nextTitle
        );


        try {

            next.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });

        } catch {
            // ignore
        }


        /**
         * 给滚动动画一点时间。
         */
        await sleep(300);


        /**
         * 再次确认用户没有自己切换课程。
         */
        if (
            video !== state.video ||
            window.location.href !==
                pageAtEnd
        ) {

            return;
        }


        if (
            clickLeaf(next)
        ) {

            log(
                '已点击下一视频：',
                nextTitle
            );
        }
    }


    /* ============================================================
     * 绑定视频
     * ============================================================ */

    function bindVideo(video) {

        if (!video) {
            return;
        }


        /**
         * 移除旧视频上的监听器。
         *
         * SPA 长时间运行时尤其重要，
         * 防止事件监听器不断累积。
         */
        state.eventController?.abort();


        const controller =
            new AbortController();


        const signal =
            controller.signal;


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


        log(
            '绑定视频：',
            state.videoSrc || video
        );


        /**
         * 应用播放倍速。
         */
        applyPlaybackRate(video);


        /**
         * metadata 加载后再设置一次。
         *
         * 防止播放器加载新资源时
         * 把 playbackRate 重置为 1。
         */
        video.addEventListener(
            'loadedmetadata',
            () => {

                applyPlaybackRate(
                    video
                );

            },
            {
                signal
            }
        );


        /**
         * 如果播放器自身重新修改播放倍速，
         * 恢复 CONFIG 中指定的值。
         *
         * 只有设置值不同的时候才会重新设置，
         * 不会形成无限 ratechange 循环。
         */
        video.addEventListener(
            'ratechange',
            () => {

                const targetRate =
                    Number(
                        CONFIG.playbackRate
                    );


                if (
                    Number.isFinite(targetRate) &&
                    targetRate > 0 &&
                    Math.abs(
                        video.playbackRate -
                        targetRate
                    ) > 0.01
                ) {

                    video.playbackRate =
                        targetRate;
                }

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
         * 主结束事件。
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
         * ended 的备用机制。
         *
         * 部分自定义播放器封装环境中，
         * ended 偶尔可能没有按照预期触发。
         *
         * 因此当：
         *
         * currentTime ≈ duration
         *
         * 时也进行一次判断。
         *
         * nextScheduled 会防止重复执行。
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
                    duration <= 0 ||
                    !Number.isFinite(
                        current
                    )
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
         * 自动播放只在绑定视频时主动尝试。
         *
         * 不会每隔一秒调用 play()，
         * 因此用户主动暂停以后不会被脚本
         * 立刻强制恢复。
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


                tryAutoPlay(
                    video
                );
            };


        /**
         * readyState >= 2：
         *
         * 已经有足够数据可以开始播放。
         */
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


    /* ============================================================
     * 扫描当前页面
     * ============================================================ */

    function scanPage() {

        /**
         * 检测 SPA URL 切换。
         */
        if (
            window.location.href !==
            state.href
        ) {

            state.href =
                window.location.href;


            state.nextScheduled =
                false;


            state.hasStarted =
                false;


            log(
                '检测到页面切换：',
                state.href
            );
        }


        /**
         * 找当前视频。
         */
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
         * 情况一：
         *
         * 新视频创建了新的 <video> DOM。
         */
        if (
            video !==
            state.video
        ) {

            bindVideo(video);

            return;
        }


        /**
         * 情况二：
         *
         * Vue / 播放器复用了原来的 <video>，
         * 只修改 src。
         */
        if (
            src &&
            src !==
            state.videoSrc
        ) {

            log(
                '检测到当前视频源发生变化'
            );


            bindVideo(video);
        }
    }


    /* ============================================================
     * DOM MutationObserver
     * ============================================================
     *
     * 新版雨课堂是 SPA。
     *
     * 点击课程目录以后不会像传统网页一样
     * 整个页面重新加载。
     *
     * MutationObserver 可以在新播放器或
     * 新视频源进入页面后尽快发现变化。
     */

    const observer =
        new MutationObserver(
            () => {

                /**
                 * 防抖：
                 *
                 * 页面可能一次触发几十个 Mutation，
                 * 没必要每一个都扫描。
                 */
                if (
                    state.scanTimer !==
                    null
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
             * 主要监听 video src 变化。
             *
             * 不监听全页面 class，
             * 避免播放器动画、进度条等
             * 产生大量无意义 Mutation。
             */
            attributes: true,

            attributeFilter: [
                'src'
            ]
        }
    );


    /* ============================================================
     * SPA / 浏览器事件
     * ============================================================ */

    window.addEventListener(
        'popstate',
        () => {

            window.setTimeout(
                scanPage,
                100
            );
        }
    );


    window.addEventListener(
        'pageshow',
        () => {

            window.setTimeout(
                scanPage,
                100
            );
        }
    );


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


    /* ============================================================
     * 定时扫描兜底
     * ============================================================
     *
     * MutationObserver 是主要方式。
     *
     * 定时器只负责兜底：
     *
     * - URL 改变
     * - Vue 状态改变
     * - 播放器内部修改
     *
     * 每 1.5 秒一次，对性能影响很小。
     */

    window.setInterval(
        scanPage,
        CONFIG.scanIntervalMs
    );


    /* ============================================================
     * 启动
     * ============================================================ */

    log(
        '脚本启动',
        `v3.0.0 | 播放速度 ${CONFIG.playbackRate}x`
    );


    scanPage();

})();
