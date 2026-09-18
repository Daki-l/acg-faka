!function () {
    const mobileAdminEnabled = () => Boolean(window.AdminMobile && window.AdminMobile.isEnabled && window.AdminMobile.isEnabled());
    const sendMessageIcon = '<svg class="md-message-send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 6.5h10a2 2 0 0 1 2 2v2.25M3.5 7l5 4 5-4M3.5 6.5v9a2 2 0 0 0 2 2h7.25M14 14h6m-2.5-2.5L20 14l-2.5 2.5"/></svg>';
    const namespace = '.mdConfigMailController';
    let controllerActive = true;
    let saveInFlight = false;
    let testSending = false;
    let formDirty = false;
    let dirtyVersion = 0;

    if (typeof window.__mdConfigMailDestroy === 'function') window.__mdConfigMailDestroy();

    function formRevision() {
        const form = document.getElementById('data-form');
        return form && window.AdminMobile?.pageWorkflows?.getRevision ? window.AdminMobile.pageWorkflows.getRevision(form) : null;
    }

    function emitFormState(name, revision) {
        const form = document.getElementById('data-form');
        if (form) document.dispatchEvent(new CustomEvent(name, {detail: {form: form, revision: revision}}));
    }

    function setSaveBusy(busy) {
        const $button = $('#data-form .save-data');
        $button.prop('disabled', busy).toggleClass('disabled', busy);
        if (busy) {
            $button.attr({'aria-busy': 'true', 'aria-disabled': 'true'});
        } else {
            $button.removeAttr('aria-busy aria-disabled');
        }
    }

    function closePrompt(index) {
        layer.close(index);
    }

    function prepareTestInput(unique) {
        $('.' + unique + ' input[name="email"]').attr({
            inputmode: 'email',
            autocomplete: 'email',
            autocapitalize: 'none',
            spellcheck: 'false'
        });
    }

    $('#data-form').off(namespace).on('input' + namespace + ' change' + namespace, 'input, textarea, select', function () {
        formDirty = true;
        dirtyVersion += 1;
        emitFormState('admin:mobile:form-dirty');
    });

    $('.save-data').off(namespace).on('click' + namespace, function () {
        if (!controllerActive || saveInFlight) return;
        if (testSending) {
            layer.msg(i18n('测试邮件正在发送，请稍候再保存'));
            return;
        }
        const revision = formRevision();
        const submittedVersion = dirtyVersion;
        const $secretFields = $('#data-form input[type="password"]');
        const submittedSecrets = new Map($secretFields.toArray().map(input => [input, input.value]));
        saveInFlight = true;
        setSaveBusy(true);
        util.post({
            url: "/admin/api/config/email",
            data: util.arrayToObject($("#data-form").serializeArray()),
            done: res => {
                if (!controllerActive) return;
                saveInFlight = false;
                setSaveBusy(false);
                submittedSecrets.forEach((value, input) => {
                    if (input.isConnected && input.value === value) input.value = '';
                });
                if (dirtyVersion === submittedVersion) formDirty = false;
                layer.msg(res.msg || i18n("保存成功"));
                emitFormState('admin:mobile:form-saved', revision);
            },
            error: res => {
                if (!controllerActive) return;
                saveInFlight = false;
                setSaveBusy(false);
                if (mobileAdminEnabled()) window.AdminMobile?.pageWorkflows?.focusFormError?.(document.getElementById('data-form'), res?.msg);
                message.error(res?.msg || i18n('邮箱设置保存失败'));
            },
            fail: () => {
                if (!controllerActive) return;
                saveInFlight = false;
                setSaveBusy(false);
                message.error('网络异常，邮箱设置未保存');
            }
        });
    });

    function sendTest(email, index) {
        const normalized = String(email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
            layer.msg(i18n('请输入正确的邮箱地址'));
            return false;
        }
        if (testSending) {
            layer.msg(i18n('测试邮件正在发送，请稍候'));
            return false;
        }
        testSending = true;
        util.post("/admin/api/config/emailTest", {email: normalized}, res => {
            testSending = false;
            if (!controllerActive) return;
            layer.msg(res.msg);
            closePrompt(index);
        }, res => {
            testSending = false;
            if (controllerActive) message.error(res?.msg || i18n('测试邮件发送失败'));
        }, () => {
            testSending = false;
            if (controllerActive) message.error('网络异常，测试邮件发送失败');
        });
        return true;
    }

    $('.send-test-message').off(namespace).on('click' + namespace, function () {
        if (saveInFlight) {
            layer.msg(i18n('邮箱设置正在保存，请稍候再测试'));
            return;
        }
        if (formDirty) {
            layer.msg(i18n('请先保存当前邮箱设置，再发送测试邮件'));
            return;
        }
        //两端统一走站内弹窗组件：layui 原生 layer.prompt 是个没有样式的小方块，
        //和后台其他配置弹窗完全不搭
        component.popup({
            width: mobileAdminEnabled() ? '420px' : '480px',
            height: 'auto',
            autoPosition: true,
            confirmText: sendMessageIcon + '<span>' + i18n('发送测试邮件') + '</span>',
            tab: [{
                name: util.icon('fa-duotone fa-regular fa-paper-plane') + ' ' + i18n('发送测试邮件'),
                form: [{
                    title: '邮箱地址',
                    name: 'email',
                    type: 'input',
                    placeholder: '请输入接收测试邮件的地址',
                    required: true,
                    tips: '将用当前已保存的 SMTP 配置向该地址发送一封测试邮件。',
                    regex: {value: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', message: i18n('请输入正确的邮箱地址')}
                }]
            }],
            renderComplete: prepareTestInput,
            submit: function (data, index) { return sendTest(data.email, index); }
        });
    });

    function destroy() {
        if (!controllerActive) return;
        controllerActive = false;
        saveInFlight = false;
        testSending = false;
        formDirty = false;
        setSaveBusy(false);
        $('#data-form, .save-data, .send-test-message').off(namespace);
        $(document).off('pjax:beforeReplace' + namespace);
        if (window.__mdConfigMailDestroy === destroy) delete window.__mdConfigMailDestroy;
    }

    window.__mdConfigMailDestroy = destroy;
    $(document).off('pjax:beforeReplace' + namespace).one('pjax:beforeReplace' + namespace, destroy);
}();

!function () {
    const namespace = '.mdOrderEmailTemplate';
    const $form = $('#order-email-template-form');
    let active = true;
    let busy = false;
    let loaded = false;

    if (!$form.length) return;
    if (typeof window.__mdOrderEmailTemplateDestroy === 'function') window.__mdOrderEmailTemplateDestroy();

    function fields() {
        return {
            logo_url: String($form.find('[name="logo_url"]').val() || '').trim(),
            subject: String($form.find('[name="subject"]').val() || '').trim(),
            html: String($form.find('[name="html"]').val() || '')
        };
    }

    function setBusy(value) {
        busy = value;
        $('.order-email-template-preview, .order-email-template-restore, .order-email-template-test, .order-email-template-save')
            .prop('disabled', value)
            .toggleClass('disabled', value)
            .attr('aria-busy', value ? 'true' : null);
    }

    function error(messageText) {
        if (active) message.error(messageText);
    }

    function applyTemplate(template) {
        if (!template || typeof template !== 'object') return;
        $form.find('[name="logo_url"]').val(template.logo_url || '');
        $form.find('[name="subject"]').val(template.subject || '');
        $form.find('[name="html"]').val(template.html || '');
    }

    function setPreview(html) {
        const preview = document.getElementById('order-email-template-preview');
        if (preview) preview.srcdoc = String(html || '');
    }

    function copyPlaceholder(value) {
        const copied = () => layer.msg('已复制 ' + value);
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(value).then(copied).catch(() => fallbackCopy(value, copied));
            return;
        }
        fallbackCopy(value, copied);
    }

    function fallbackCopy(value, done) {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (copied) done();
        else error('无法复制占位符，请手动复制');
    }

    function renderPlaceholders(placeholders) {
        const container = document.getElementById('order-email-template-placeholders');
        if (!container) return;
        container.textContent = '';
        Object.entries(placeholders || {}).forEach(([name, label]) => {
            const placeholder = '{{' + name + '}}';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-sm btn-light-primary md-order-email-template__placeholder';
            button.dataset.placeholder = placeholder;
            button.title = String(label || name) + '，点击复制';
            button.textContent = placeholder;
            container.appendChild(button);
        });
    }

    function ensureLoaded() {
        if (loaded) return true;
        layer.msg('邮件模板正在加载，请稍候');
        return false;
    }

    function refreshPreview(notice) {
        if (!active || busy || !ensureLoaded()) return;
        setBusy(true);
        util.post({
            url: '/admin/api/config/orderEmailTemplatePreview',
            data: fields(),
            done: res => {
                if (!active) return;
                setBusy(false);
                setPreview(res.data?.html);
                if (notice) layer.msg('预览已刷新');
            },
            error: res => {
                if (!active) return;
                setBusy(false);
                error(res?.msg || '邮件模板预览失败');
            },
            fail: () => {
                if (!active) return;
                setBusy(false);
                error('网络异常，邮件模板预览失败');
            }
        });
    }

    function saveTemplate() {
        if (!active || busy || !ensureLoaded()) return;
        setBusy(true);
        util.post({
            url: '/admin/api/config/orderEmailTemplateSave',
            data: fields(),
            done: res => {
                if (!active) return;
                setBusy(false);
                applyTemplate(res.data?.template);
                layer.msg(res.msg || '模板已保存');
                refreshPreview(false);
            },
            error: res => {
                if (!active) return;
                setBusy(false);
                error(res?.msg || '邮件模板保存失败');
            },
            fail: () => {
                if (!active) return;
                setBusy(false);
                error('网络异常，邮件模板保存失败');
            }
        });
    }

    function restoreTemplate() {
        if (!active || busy || !ensureLoaded()) return;
        layer.confirm('恢复后将覆盖当前未保存的模板内容，是否继续？', {btn: ['恢复默认', '取消']}, index => {
            layer.close(index);
            setBusy(true);
            util.post({
                url: '/admin/api/config/orderEmailTemplateRestore',
                data: {},
                done: res => {
                    if (!active) return;
                    setBusy(false);
                    applyTemplate(res.data?.template);
                    layer.msg(res.msg || '已恢复默认模板');
                    refreshPreview(false);
                },
                error: res => {
                    if (!active) return;
                    setBusy(false);
                    error(res?.msg || '恢复默认模板失败');
                },
                fail: () => {
                    if (!active) return;
                    setBusy(false);
                    error('网络异常，恢复默认模板失败');
                }
            });
        });
    }

    function sendTemplateTest(address, index) {
        const email = String(address || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            layer.msg('请输入正确的邮箱地址');
            return false;
        }
        if (busy || !ensureLoaded()) return false;
        setBusy(true);
        util.post({
            url: '/admin/api/config/orderEmailTemplateTest',
            data: {...fields(), email: email},
            done: res => {
                if (!active) return;
                setBusy(false);
                layer.msg(res.msg || '测试邮件发送成功');
                layer.close(index);
            },
            error: res => {
                if (!active) return;
                setBusy(false);
                error(res?.msg || '测试邮件发送失败');
            },
            fail: () => {
                if (!active) return;
                setBusy(false);
                error('网络异常，测试邮件发送失败');
            }
        });
        return true;
    }

    function showTestDialog() {
        if (busy || !ensureLoaded()) return;
        component.popup({
            width: '480px',
            height: 'auto',
            autoPosition: true,
            confirmText: '<i class="fa-duotone fa-regular fa-paper-plane"></i> 发送模板测试邮件',
            tab: [{
                name: '发送模板测试邮件',
                form: [{
                    title: '邮箱地址',
                    name: 'email',
                    type: 'input',
                    placeholder: '请输入接收测试邮件的地址',
                    required: true,
                    regex: {value: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', message: '请输入正确的邮箱地址'}
                }]
            }],
            submit: (data, index) => sendTemplateTest(data.email, index)
        });
    }

    function loadTemplate() {
        setBusy(true);
        util.post({
            url: '/admin/api/config/orderEmailTemplateGet',
            data: {},
            done: res => {
                if (!active) return;
                setBusy(false);
                applyTemplate(res.data?.template);
                renderPlaceholders(res.data?.placeholders);
                loaded = true;
                refreshPreview(false);
            },
            error: res => {
                if (!active) return;
                setBusy(false);
                error(res?.msg || '邮件模板加载失败');
            },
            fail: () => {
                if (!active) return;
                setBusy(false);
                error('网络异常，邮件模板加载失败');
            }
        });
    }

    $('#order-email-template-placeholders').off(namespace).on('click' + namespace, '[data-placeholder]', function () {
        copyPlaceholder(String(this.dataset.placeholder || ''));
    });
    $('.order-email-template-preview').off(namespace).on('click' + namespace, () => refreshPreview(true));
    $('.order-email-template-save').off(namespace).on('click' + namespace, saveTemplate);
    $('.order-email-template-restore').off(namespace).on('click' + namespace, restoreTemplate);
    $('.order-email-template-test').off(namespace).on('click' + namespace, showTestDialog);

    function destroy() {
        if (!active) return;
        active = false;
        $form.off(namespace);
        $('#order-email-template-placeholders, .order-email-template-preview, .order-email-template-save, .order-email-template-restore, .order-email-template-test').off(namespace);
        $(document).off('pjax:beforeReplace' + namespace);
        setPreview('');
        if (window.__mdOrderEmailTemplateDestroy === destroy) delete window.__mdOrderEmailTemplateDestroy;
    }

    window.__mdOrderEmailTemplateDestroy = destroy;
    $(document).off('pjax:beforeReplace' + namespace).one('pjax:beforeReplace' + namespace, destroy);
    loadTemplate();
}();
