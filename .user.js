// ==UserScript==
// @name         雨课堂自动连续播放
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  新版雨课堂：视频结束后自动进入并尝试播放下一个视频
// @match        https://*.yuketang.cn/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log('[雨课堂助手] 启动');

    let boundVideo = null;
    let lastUrl = location.href;
    let nextTriggered = false;

    // 找下一个视频
    function getNextVideoLeaf() {

        const leaves = Array.from(
            document.querySelectorAll('.leaf-item')
        );

        const currentIndex = leaves.findIndex(el =>
            el.classList.contains('is-active')
        );

        if (currentIndex === -1) {
            console.log('[雨课堂助手] 没找到当前课程');
            return null;
        }

        console.log(
            '[雨课堂助手] 当前课程：',
            leaves[currentIndex].innerText.trim()
        );

        // 从当前课程后面寻找第一个视频
        for (let i = currentIndex + 1; i < leaves.length; i++) {

            const tag =
                leaves[i].querySelector('.leaf-item-tag');

            if (
                tag &&
                tag.textContent.trim() === '视频'
            ) {
                console.log(
                    '[雨课堂助手] 下一个视频：',
                    leaves[i].innerText.trim()
                );

                return leaves[i];
            }
        }

        return null;
    }

    // 前往下一个视频
    function goNextVideo() {

        if (nextTriggered) {
            return;
        }

        nextTriggered = true;

        const next = getNextVideoLeaf();

        if (!next) {
            console.log('[雨课堂助手] 已经没有后续视频');
            return;
        }

        console.log('[雨课堂助手] 3秒后进入下一视频');

        setTimeout(() => {

            next.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            setTimeout(() => {

                console.log('[雨课堂助手] 点击下一视频');

                next.click();

            }, 500);

        }, 3000);
    }

    // 尝试播放
    function tryPlay(video) {

        if (!video.paused) {
            return;
        }

        video.play()
            .then(() => {
                console.log('[雨课堂助手] 自动播放成功');
            })
            .catch(() => {
                console.log(
                    '[雨课堂助手] 浏览器阻止自动播放，请手动点一次播放'
                );
            });
    }

    // 绑定当前视频
    function bindVideo() {

        const video = document.querySelector(
            'video.xt_video_player, video'
        );

        if (!video) {
            return;
        }

        // 已经绑定过
        if (video === boundVideo) {
            return;
        }

        boundVideo = video;
        nextTriggered = false;

        console.log(
            '[雨课堂助手] 已绑定视频：',
            video
        );

        // 尝试自动播放
        setTimeout(() => {
            tryPlay(video);
        }, 1000);

        // 正常结束
        video.addEventListener('ended', () => {

            console.log('[雨课堂助手] 视频播放结束');

            goNextVideo();
        });

        // ended 没触发时的兜底
        video.addEventListener('timeupdate', () => {

            if (
                video.duration &&
                video.currentTime >= video.duration - 0.3
            ) {
                goNextVideo();
            }

        });
    }

    // 雨课堂使用 SPA，持续检测页面变化
    setInterval(() => {

        if (location.href !== lastUrl) {

            console.log(
                '[雨课堂助手] 已进入新页面：',
                location.href
            );

            lastUrl = location.href;

            boundVideo = null;
            nextTriggered = false;
        }

        bindVideo();

    }, 1000);

})();
